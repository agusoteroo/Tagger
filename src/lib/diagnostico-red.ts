import dns from "node:dns/promises";
import net from "node:net";
import { conLimite } from "./limite-tiempo";

/**
 * Diagnostico de red hasta la base, paso por paso.
 *
 * Existe por una falla que no se podia diagnosticar de otra forma: la consulta
 * a Supabase no volvia y la funcion moria por tiempo, sin decir si el problema
 * era el nombre, la ruta de red, el TLS o la consulta en si. Cada paso tiene su
 * propio limite, asi que el que falla es el que rompio.
 *
 * NUNCA devuelve la contrasena ni la cadena completa: solo host, puerto y que
 * paso en cada tramo.
 */

export type PasoDiag = { paso: string; ok: boolean; ms: number; detalle: string };

function destino(url: string): { host: string; puerto: number } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname, puerto: Number(u.port || 5432) };
  } catch {
    return null;
  }
}

async function medir(paso: string, ms: number, tarea: () => Promise<string>): Promise<PasoDiag> {
  const t0 = Date.now();
  try {
    const detalle = await conLimite(paso, ms, tarea);
    return { paso, ok: true, ms: Date.now() - t0, detalle };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { paso, ok: false, ms: Date.now() - t0, detalle: msg.slice(0, 200) };
  }
}

export async function diagnosticarRed(url: string | undefined): Promise<PasoDiag[]> {
  if (!url) return [{ paso: "leer DATABASE_URL", ok: false, ms: 0, detalle: "no esta definida" }];

  const d = destino(url);
  if (!d) {
    return [{ paso: "leer DATABASE_URL", ok: false, ms: 0, detalle: "no es una URL valida" }];
  }

  const pasos: PasoDiag[] = [
    { paso: "destino", ok: true, ms: 0, detalle: `${d.host}:${d.puerto}` },
  ];

  // 1. Resolver el nombre. Con `all` se ven las dos familias: si solo hay AAAA
  //    y la salida a internet no tiene IPv6, el TCP se cuelga sin explicacion.
  pasos.push(
    await medir("dns", 4000, async () => {
      const dirs = await dns.lookup(d.host, { all: true });
      return dirs.map((a) => `${a.address} (IPv${a.family})`).join(", ") || "sin direcciones";
    })
  );

  // 2. TCP crudo. Separa "no hay ruta / puerto cerrado" de "TLS o auth".
  pasos.push(
    await medir("tcp", 6000, async () => {
      await new Promise<void>((listo, error) => {
        const s = net.connect({ host: d.host, port: d.puerto });
        s.once("connect", () => {
          s.destroy();
          listo();
        });
        s.once("error", (e) => {
          s.destroy();
          error(e);
        });
      });
      return "conecta";
    })
  );

  // 3. Handshake SSL del protocolo de Postgres.
  //
  //    OJO: Postgres NO habla TLS directo en el puerto. Primero hay que
  //    mandarle un paquete SSLRequest (8 bytes: largo 8 y el codigo 80877103) y
  //    el servidor contesta un solo byte: 'S' acepta cifrado, 'N' lo rechaza.
  //    Un tls.connect() crudo contra este puerto da un resultado falso, porque
  //    el servidor esta esperando el paquete de arranque, no un ClientHello.
  //
  //    Este paso distingue "la ruta de red funciona y hay un Postgres del otro
  //    lado" de "conecta con algo que no es Postgres" (un balanceador, un
  //    proxy, una pagina de error).
  pasos.push(
    await medir("ssl-postgres", 8000, async () => {
      const SSL_REQUEST = Buffer.alloc(8);
      SSL_REQUEST.writeInt32BE(8, 0);
      SSL_REQUEST.writeInt32BE(80877103, 4);

      return await new Promise<string>((listo, error) => {
        const s = net.connect({ host: d.host, port: d.puerto });
        s.once("connect", () => s.write(SSL_REQUEST));
        s.once("data", (b: Buffer) => {
          const r = String.fromCharCode(b[0]!);
          s.destroy();
          listo(
            r === "S"
              ? "el servidor acepta TLS (es un Postgres)"
              : r === "N"
                ? "responde pero RECHAZA TLS"
                : `respuesta inesperada: ${JSON.stringify(b.subarray(0, 16).toString("utf8"))}`
          );
        });
        s.once("error", (e) => {
          s.destroy();
          error(e);
        });
      });
    })
  );

  // 4. El driver de verdad. Los tres pasos de arriba pueden dar bien y aun asi
  //    postgres.js no conectar: credenciales mal, o la libreria empaquetada por
  //    el bundler y con los sockets roto. Este paso trae SU error, textual, que
  //    es lo que no se veia cuando la peticion simplemente no volvia.
  pasos.push(
    await medir("driver", 12000, async () => {
      const { default: postgres } = await import("postgres");
      const cliente = postgres(url, { prepare: false, max: 1, connect_timeout: 8, onnotice: () => {} });
      try {
        const r = await cliente`select 1 as uno, current_user as usuario, version() as v`;
        const f = r[0] as { uno: number; usuario: string; v: string } | undefined;
        return `select 1 -> ${f?.uno}, usuario=${f?.usuario}, ${String(f?.v).slice(0, 40)}`;
      } finally {
        await cliente.end({ timeout: 2 });
      }
    })
  );

  return pasos;
}
