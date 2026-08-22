# ENPLAS · Etiquetado

Trazabilidad de cajas en planta. Reemplaza el artifact de una sola pieza
(`etiquetado-enplas_2.jsx`) por una app web con base de datos real.

**Estado: pasos 1 y 2 de 4 terminados** — base de datos, backend y las seis
pantallas, con el ciclo de vida de lotes que usa la planta. Falta la impresión
ZPL (paso 3) y el despliegue en planta (paso 4).

## Documentos

| | |
|---|---|
| [ENTREGA.md](ENTREGA.md) | Cómo se le entrega al cliente: las dos etapas, el checklist de instalación, la capacitación y lo que hay que definir antes |
| [MANUAL.md](MANUAL.md) | Manual de uso, un capítulo por rol. Para imprimir y dejar en planta |
| [DESPLIEGUE.md](DESPLIEGUE.md) | Backups, migraciones y opciones de hosting |

---

## Arrancar

```bash
npm install
npm run db:reset     # crea la base y la siembra con datos de ejemplo
npm run dev          # http://localhost:3000
```

PINs de ejemplo: **jefe de planta `3690`**, **calidad `2468`**, **admin `1357`**.
Cambialos antes de planta (Configuración → PINs).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Server de desarrollo |
| `npm run build` / `npm start` | Build y arranque de producción |
| `npm run db:reset` | **Borra** la base y la vuelve a sembrar (solo desarrollo) |
| `npm run db:seed` | Siembra sin borrar (idempotente) |
| `npm run db:studio` | Explorador visual de la base |
| `npm run backup` | Copia consistente y verificada de la base (`VACUUM INTO`) |
| `npm run demo:preparar` | Rota los PINs, carga datos de ejemplo y prende el banner de prueba |
| `npm run db:demo` | Genera 12 días de producción de ejemplo, para ver las métricas |
| `npm test` | Corre las cinco suites (independientes del orden) |
| `npm run test:lotes` | Objetivo, cierre por cambio de producción, numeración |
| `npm run test:flujo` | Flujo completo y permisos — **necesita el server en :3100** |
| `npm run test:export` | Que el CSV coincida con la pantalla — **necesita el server** |
| `npm run test:metricas` | Agregaciones cruzadas contra SQL escrito a mano |
| `npm run test:concurrencia` | Demuestra el bug de cajas duplicadas y que está arreglado |

---

## Despliegue

Va **en la nube, en Fly.io con volumen persistente**. Los pasos, los backups y
las migraciones están en [DESPLIEGUE.md](DESPLIEGUE.md).

Dos cosas que salen de estar en la nube y conviene tener presentes:

- La impresora vive en la LAN de la fábrica, así que hace falta un **agente
  local** que consulte la nube y le mande el ZPL — ver
  [`agente-impresion/`](agente-impresion/README.md). La nube no elimina el equipo
  en planta, lo hace más chico.
- **Sin internet no se puede etiquetar**, y no tiene arreglo con un buffer local:
  el número de caja necesita una sola autoridad.

## Por qué SQLite y no Postgres

Con **una estación** de etiquetado, SQLite gana:

- **Nada que mantener en planta.** No hay Docker, no hay demonio que arranque
  mal después de un corte de luz. Es Node leyendo un archivo.
- **El backup es copiar un archivo.** Literalmente `copy etiquetado.db`.
- **Alcanza de sobra.** Medido en esta máquina: **146 etiquetas/s** con
  `synchronous = FULL` (fsync en cada commit). La estación genera menos de una
  por segundo. Hay ~500x de margen.
- **Modo WAL**: los dashboards leen mientras la estación escribe, sin bloquearse.
  Eso es lo que hace que consultar desde otra computadora nunca interfiera con
  etiquetar.

Si algún día hay varias plantas o varias estaciones pesadas, migrar a Postgres
es cambiar el driver de Drizzle: el esquema y la lógica quedan igual.

**Restricción que hay que respetar:** esto no se puede escalar a más de una
máquina. SQLite necesita un solo proceso escribiendo — dos máquinas sobre el
mismo volumen corromperían la base. `fly.toml` lo fija y lo explica ahí mismo.

---

## Los tres problemas del artifact original, y cómo se resuelven

### 1. Cajas duplicadas (el grave)

El artifact calculaba `nextCaja = machine.cajaCounter + 1` **en el navegador** y
después persistía. Entre la lectura y la escritura hay un hueco, y ahí se cuela
otro cliente.

Ahora el número se asigna en el servidor con **dos defensas**:

- `BEGIN IMMEDIATE` — toma el lock de escritura *antes* de leer `MAX(caja)`,
  así ningún otro proceso se mete en el medio.
- `UNIQUE (lote_id, caja)` — si por cualquier motivo se colara, la base lo
  rechaza en vez de guardar un duplicado silencioso.

Medido con 6 procesos reales escribiendo a la vez sobre el mismo archivo
(`npm run test:concurrencia`):

```
Lógica original .... 120 cajas grabadas, 46 números distintos, 37 DUPLICADOS
Sistema nuevo ...... 120 cajas numeradas 1..120, 0 duplicados, 0 huecos
```

### 2. Los PINs viajaban al navegador

El artifact comparaba `pin === config.pins.admin` en el cliente: cualquiera con
las DevTools abiertas veía el PIN de admin.

Ahora se guardan **hasheados con scrypt**, se validan del lado del servidor y
nunca bajan en ningún payload. La sesión es una cookie `httpOnly` firmada con
HMAC, con 30 minutos de inactividad.

### 3. El historial era un solo JSON

Cada etiqueta reescribía el array completo. Ahora es una tabla indexada, con
paginación y búsqueda.

### 4. El PIN no tenía límite de intentos

Un PIN de 4 dígitos son 10.000 combinaciones: un script las prueba en minutos.
En la LAN de la planta el riesgo es bajo, pero esto va a estar detrás de un túnel
con URL pública. Ahora hay bloqueo progresivo por origen (30s, 60s, 120s… con
techo de 15 minutos) después de 8 intentos fallidos.

---

## Decisiones del modelo de datos

**El lote es una fila, no un string.** En el artifact el lote vivía dentro de la
máquina y cambiarlo reseteaba el contador a 0. Ahora `lotes` es una tabla: se
abre, se cierra, y la numeración de cajas cuelga de él. Eso es lo que permite
numerar de forma atómica y tener historial de lotes cerrados.

**Los datos se duplican a propósito en la etiqueta.** Cada fila de `etiquetas`
guarda el nombre de la máquina, del frasco, del operario y el código de lote
*además* de las claves foráneas. No es un error de normalización: una etiqueta
es un **documento histórico**. Si mañana renombran una máquina, las etiquetas de
ayer tienen que seguir diciendo lo que decían cuando se imprimieron.

**Nada se borra.** Anular una etiqueta es un estado (`anulada`, con motivo y
responsable), no un `DELETE`. Y el número de caja anulado **no se reusa**: el
hueco en la secuencia es la evidencia de que ahí hubo una caja.

**Todo queda auditado.** Tabla `auditoria` con quién abrió lotes, quién liberó,
quién anuló y quién reimprimió. La primera impresión no se audita (es el flujo
normal); las reimpresiones sí.

---

## API

| Método | Ruta | Rol | Qué hace |
|---|---|---|---|
| `GET` | `/api/catalogos` | — | Todo lo que la pantalla necesita para arrancar |
| `GET` | `/api/resumen` | — | Métricas para dashboards |
| `GET` | `/api/etiquetas` | — | Historial. Filtros: `q`, `desde`, `hasta`, `operarioId`, `maquina`, `turno`, `frasco`, `loteId`, `estado`, `soloAnuladas`, `incluirAnuladas` |
| `GET` | `/api/metricas` | — | Agregaciones de eficiencia (`dim=` + los mismos filtros) |
| `GET` | `/api/export` | — | CSV del historial, o del resumen si se pasa `dim=` |
| `POST` | `/api/etiquetas` | — | **Generar etiqueta** (numeración atómica) |
| `POST` | `/api/etiquetas/calidad` | calidad | Liberar o rechazar en lote |
| `POST` | `/api/etiquetas/:id/imprimir` | — | Cuenta la impresión, audita reimpresiones |
| `POST` | `/api/etiquetas/:id/anular` | admin | Anula (no borra) |
| `GET` | `/api/lotes` | — | Lotes con su progreso (`?estado=abierto\|cerrado`) |
| `POST` | `/api/lotes` | lotes | Abrir un lote con su objetivo. **Cierra el que estuviera abierto** |
| `PATCH` | `/api/lotes/:id` | lotes | Cerrar a mano (la máquina queda parada), o corregir el objetivo |
| `POST` | `/api/auth/pin` | — | Login por PIN |
| `POST` | `/api/auth/salir` | — | Bloquear pantalla |
| `POST` `PATCH` `DELETE` | `/api/catalogos/{maquinas,operarios,frascos,turnos}` | admin | Altas, bajas y ediciones |
| `POST` | `/api/config/pin` | admin | Cambiar un PIN |

Generar etiquetas **no pide PIN a propósito**: el operario tiene que poder
producir sin loguearse. Lo que se protege es liberar calidad (PIN calidad),
abrir lotes y anular (PIN admin).

---

## Variables de entorno

```
DB_PATH=data/etiquetado.db
PRINTER_HOST=            # IP de la impresora en la LAN — se completa en el paso 3
PRINTER_PORT=9100
SESSION_SECRET=          # opcional: si no está, se genera y persiste solo
TZ_OFFSET_HORAS=-3       # zona horaria de la planta, para agrupar por día
```

---

## Cómo funciona un lote

Así trabaja la planta, y así lo modela el sistema:

1. El **jefe de planta** abre un lote desde un formulario, con un **objetivo** en
   unidades o en cajas (lo elige en cada lote).
2. El **número de lote lo asigna el sistema**, siguiendo una secuencia **por
   producto**: el lote 100 del frasco 250ml y el 100 del 1L son dos lotes
   distintos. En la etiqueta se imprime con el prefijo del producto (`F250-100`)
   para que no haya ambigüedad.
3. La máquina etiqueta **hasta que se cambie la producción**. El objetivo no
   cierra nada: pasarse es normal y queda medido.
4. Cuando el jefe **carga otro lote en esa máquina**, el anterior se cierra en
   ese momento y las cajas del nuevo vuelven a numerarse desde **#1**.

### El objetivo NO cierra el lote

Esta fue una corrección del cliente, y es la regla central del sistema.

La primera versión cerraba el lote al alcanzar la cantidad planificada, y tenía
una cola de lotes "preparados" que arrancaban solos para que la línea no se
detuviera. No es así como trabaja la planta: **lo que termina un lote es que la
máquina se ponga a hacer otra cosa.** En palabras del cliente: "estoy haciendo
medias en una máquina y cargo un lote de mandarinas a hacerse en esa máquina".

Consecuencias, todas deliberadas:

- El `limite` es un **objetivo de producción**, no un tope. El porcentaje pasa de
  100 y eso es un dato de sobreproducción, no un error.
- **Cargar un lote cierra el que estaba**, aunque sea del mismo producto. Una
  máquina tiene un lote a la vez, sin excepciones: es la regla más simple de
  explicar en planta y no deja casos raros. El precio es que un clic de más
  cierra un lote recién arrancado, así que la API devuelve cuál cerró y con
  cuánto, y la pantalla lo muestra antes de confirmar.
- **La cola desapareció.** Existía para que la línea no se detuviera sola. Sola
  ya no se detiene.
- El cierre manual sigue existiendo, y ahí sí **la máquina queda parada**: sirve
  para cortar turno o parar por mantenimiento.

El invariante está garantizado por la base, no por el código: un índice único
parcial permite **un solo lote abierto por máquina**. Misma idea que
`UNIQUE(lote_id, caja)` — la regla que el sistema no puede permitirse violar vive
en el esquema.

### Detalles que importan

- **Las anuladas no cuentan para el objetivo** (la caja no sirve), pero **sí
  consumen número de caja**: el hueco en la secuencia es la evidencia.
- **Corregir el objetivo de un lote abierto no lo cierra**, ni dejándolo por
  debajo de lo ya producido: el jefe se dio cuenta de que planificó de más.
- **Cambiar de producto** se hace al abrir un lote, no en Configuración: es el
  único momento en que no se mezcla producto dentro de un mismo lote.

## Roles

El modelo de permisos **no es una escalera**. El jefe de planta abre lotes pero
no dictamina calidad; Calidad dictamina pero no abre lotes. Ninguno es "más" que
el otro, así que cada rol tiene un conjunto explícito de permisos:

| Rol | etiquetar | ver | lotes | calidad | anular | config |
|---|---|---|---|---|---|---|
| Operario (sin PIN) | ✓ | | | | | |
| Jefe de planta | ✓ | ✓ | ✓ | | | |
| Calidad | ✓ | ✓ | | ✓ | | |
| Administración | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Las pantallas

| Pantalla | Permiso | Qué hace |
|---|---|---|
| **Etiquetar** | libre | Flujo de 4 pasos del artifact original, más el progreso del lote contra su límite |
| **Lotes** | lotes | El formulario del jefe: abrir con límite, cola, cierre manual, cancelar |
| **Calidad** | calidad | Liberar o **rechazar** en lote (el original solo liberaba), con responsable y nota |
| **Eficiencia** | ver | Nueva. Producción por operario / turno / máquina / frasco / día / lote |
| **Historial** | ver | Filtros por operario, máquina, turno, estado y rango de fechas, más export |
| **Configuración** | config | Máquinas, frascos, operarios, turnos y cambio de PINs |

## Medir eficiencia

Lo que el artifact no podía hacer: cruzar **cualquier dimensión** con
**cualquier filtro** sobre un rango de fechas.

```
GET /api/metricas?dim=operario&desde=2026-08-01&hasta=2026-08-20&turno=Noche
```

Devuelve por grupo: cajas, unidades, liberadas, pendientes, rechazadas,
anuladas, días trabajados, horas trabajadas, cajas/hora, cajas/día y % de
rechazo.

### Dos números que hay que saber leer

**`% Rechazo`** se calcula sobre las cajas ya **dictaminadas** (liberadas +
rechazadas), no sobre el total. Si no lo hiciéramos así, un lote recién
producido con todo pendiente mostraría 0% de rechazo y parecería perfecto.

**`Cajas/hora`** usa las horas *trabajadas*, que se calculan sumando, día por
día, el lapso entre la primera y la última caja de ese grupo. La alternativa
obvia —el lapso entre la primera y la última caja del rango— da números falsos:
para un operario medido sobre 12 días incluiría noches y fines de semana. Con
los datos de ejemplo la diferencia es grande:

```
María González:  97,1 h trabajadas  ->  5,6 cajas/h
                227   h de lapso    ->  2,4 cajas/h   <- el número falso
```

Sigue siendo una aproximación: no ve el tiempo antes de la primera caja ni
después de la última, y sí cuenta las pausas del medio. Sirve para comparar
operarios en condiciones parecidas, no como medida absoluta.

## Zona horaria

Las marcas de tiempo se guardan en **UTC** (no cambian nunca, ordenan siempre),
pero agrupar "por día" usa el día **local de la planta** (`TZ_OFFSET_HORAS`,
por defecto `-3`).

No es un detalle: con los datos de ejemplo, **295 de 1793 etiquetas caerían en
el día equivocado** si se agrupara por UTC, porque el turno noche cruza la
medianoche. Todo eso vive en `src/lib/tiempo.ts`.

## Reporte para el cliente

Botón **Generar reporte** en la pantalla de Eficiencia. Baja un **HTML
autocontenido**: un solo archivo, sin CSS ni fuentes ni scripts externos.

Por qué un archivo y no un link: la app corre en la planta. Un link dependería
de que esa máquina esté prendida y con el túnel arriba. El archivo viaja solo —
se manda por mail o WhatsApp y el cliente lo abre en la computadora o en el
celular, **sin internet y sin que la planta tenga nada prendido**.

Respeta **los mismos filtros que la pantalla**: rango de fechas, operario,
máquina, turno y producto. Y si hay algún filtro activo lo dice arriba, en un
recuadro:

> **Reporte parcial.** Estos números NO son de toda la planta: están filtrados
> por **Operario: Juan Pérez** · **Turno: Noche**

Eso no es decoración. Un reporte que cubre a un solo operario y no lo aclara
hace que el que lo recibe lea los totales como si fueran de toda la planta.

Contenido: totales del período, gráfico de cajas por día, tablas por operario /
turno / máquina / producto, los lotes cerrados en el período, y una nota
explicando cómo se calculan `% Rechazo` y `Cajas/h`. Lleva la fecha de
generación bien visible, porque es una foto del momento y no se actualiza sola.

```
GET /api/reporte?desde=&hasta=&operarioId=&maquina=&turno=&frasco=
GET /api/reporte?...&ver=1     # lo abre en una pestaña en vez de bajarlo
```

## Export

Sale **CSV**, no XLSX: Excel lo abre igual (lleva BOM UTF-8 para los acentos y
una línea `sep=;` para el separador en Excel en español), y evita una
dependencia en el servidor.

Lo importante es que usa **exactamente los mismos filtros** que la pantalla, así
que el archivo siempre coincide con lo que se ve. `npm run test:export` lo
verifica en 8 combinaciones de filtros: si el CSV y la pantalla difirieran en una
sola fila, el test falla.

```
GET /api/export?operarioId=3&desde=2026-08-01   -> historial detallado
GET /api/export?dim=operario&desde=2026-08-01   -> resumen de eficiencia
```

## Lo que falta

- **Paso 3** — impresión ZPL por TCP al puerto 9100, con código de barras
  Code128 en la etiqueta. Reemplaza `window.print()`. El hook ya está en
  `POST /api/etiquetas/:id/imprimir`.
- **Paso 4** — backup nocturno automático, Cloudflare Tunnel + Access para
  acceso remoto, y modo kiosko en la estación.

### Antes de poner esto en planta

- [ ] Cambiar los dos PINs por defecto
- [ ] Definir `SESSION_SECRET`
- [ ] Configurar el backup nocturno (`data/etiquetado.db` + los `-wal`/`-shm`)
- [ ] Poner `NODE_ENV=production` (además, bloquea `db:reset`)

---

## Nota sobre `npm audit`

Quedan 4 vulnerabilidades moderadas, todas dentro de `esbuild` como dependencia
de **`drizzle-kit`**, que es `devDependency` y no se despacha a producción. El
aviso es sobre el dev server de esbuild, que acá nunca se expone. Arreglarlo
requiere bajar `drizzle-kit` a la 0.18, que es una regresión mayor. Las
dependencias de producción están en cero.
