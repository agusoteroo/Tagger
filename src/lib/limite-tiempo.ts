/**
 * Corta una promesa que tarda demasiado.
 *
 * Existe por una falla concreta: una peticion a /api/salud se colgo 300
 * segundos en Vercel y murio con "Task timed out", sin una sola linea de log.
 * Sin limite propio, una consulta que no vuelve consume el maximo de la
 * funcion, no deja diagnostico y encima gasta cuota.
 *
 * Con esto la peticion falla en segundos y dice QUE paso esperando.
 *
 * Ojo con lo que este limite NO hace: no cancela la consulta del otro lado. La
 * base sigue trabajando hasta terminar. Sirve para responder y para dejar
 * rastro, no para liberar recursos del servidor.
 */
export class ErrorTiempoLimite extends Error {
  constructor(
    public readonly paso: string,
    public readonly ms: number
  ) {
    super(`"${paso}" no respondio en ${ms} ms`);
    this.name = "ErrorTiempoLimite";
  }
}

export async function conLimite<T>(paso: string, ms: number, tarea: () => Promise<T>): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tarea(),
      new Promise<never>((_, rechazar) => {
        reloj = setTimeout(() => rechazar(new ErrorTiempoLimite(paso, ms)), ms);
      }),
    ]);
  } finally {
    // Sin esto el timer queda vivo y la funcion serverless no termina hasta que
    // se dispare, aunque la respuesta ya se haya enviado.
    if (reloj) clearTimeout(reloj);
  }
}
