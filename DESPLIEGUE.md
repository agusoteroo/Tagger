# Despliegue en la nube (Fly.io)

Decisión del cliente: la app va en la nube, para consultar dashboards desde
cualquier computadora sin depender de un equipo en la planta.

---

## Por qué Fly.io y no Vercel

Las plataformas serverless (Vercel, Netlify, Cloudflare Workers) tienen
**filesystem efímero y múltiples instancias**. Con eso SQLite queda descartado:
la base se borraría en cada deploy y dos instancias escribiendo el mismo archivo
lo corromperían.

Ir a serverless obligaría a portar todo a Postgres, y con eso hay que **rehacer y
volver a verificar la numeración atómica de cajas** — la pieza más delicada del
sistema, la que garantiza que nunca haya dos cajas con el mismo número.

Fly.io corre **un contenedor real con un volumen persistente**. Es nube de
verdad (URL estable, accesible desde cualquier lado, nada que dependa de una PC)
pero con un filesystem normal, así que el código de numeración queda intacto y
todo lo que ya está probado sigue valiendo.

### La restricción que hay que respetar

**Esto NO se puede escalar a más de una máquina.**

SQLite necesita un solo proceso escribiendo. Dos máquinas sobre el mismo volumen
corromperían la base; dos volúmenes distintos darían dos historiales que no se
hablan. Por eso `fly.toml` fija `min_machines_running = 1` y
`auto_stop_machines = "off"`, y hay un comentario grande explicándolo ahí mismo.

Si alguna vez hace falta escalar de verdad (varias plantas, muchas estaciones),
el camino es migrar a Postgres: cambia el driver de Drizzle, el esquema y la
lógica quedan.

---

## Primera vez

```bash
# 1. Instalar flyctl
winget install Fly.Flyctl

# 2. Entrar (la cuenta queda a nombre de la consultora).
#    Toda organizacion en Fly necesita una tarjeta en el archivo.
fly auth login

# 3. Crear la app SIN desplegarla todavía
fly launch --no-deploy --name enplas-etiquetado --region gru

# 4. Crear el volumen donde vive la base
fly volumes create datos --size 1 --region gru

# 5. Secreto de sesión (si no se define, la app genera uno y lo persiste,
#    pero conviene fijarlo para que sobreviva a un recreado del volumen)
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)

# 6. Desplegar
fly deploy
```

La URL queda en `https://enplas-etiquetado.fly.dev`.

## Después de desplegar

```bash
# Cargar los catálogos iniciales (máquinas, frascos, operarios, turnos y PINs)
fly ssh console -C "node /app/scripts/seed.js"
```

**Cambiá los tres PINs** entrando a Configuración → PINs con el de admin. Los del
seed están en el repo.

## Comandos del día a día

| Qué | Comando |
|---|---|
| Ver logs en vivo | `fly logs` |
| Estado de la máquina | `fly status` |
| Entrar por SSH | `fly ssh console` |
| Backup manual | `fly ssh console -C "node /app/scripts/backup.js /data/backups"` |
| Bajar un backup | `fly ssh sftp get /data/backups/etiquetado-XXX.db` |
| Reiniciar | `fly apps restart enplas-etiquetado` |

## Qué se guarda en Fly, y cuánto pesa

**Toda la base es un solo archivo**: `/data/etiquetado.db` en el volumen. Ahí
está el sistema completo — etiquetas, lotes, catálogos, la auditoría y los PINs
(hasheados). No hay nada más que respaldar.

Medido con un año de producción real (200 cajas/día × 300 días):

| | |
|---|---|
| Etiquetas | 60.000 |
| Filas de auditoría | 120.300 |
| **Tamaño** | **34 MB** |
| Por etiqueta (con índices y auditoría) | 594 bytes |

Proyección: **1 año ≈ 34 MB · 5 años ≈ 170 MB · 10 años ≈ 340 MB**.

Por eso el volumen es de **1 GB**: alcanza para unos 30 años. Si alguna vez
hiciera falta, se agranda en caliente con `fly volumes extend <id> -s 3`.

Una consecuencia linda de que sea un solo archivo: **bajarte la base entera es un
comando**. No dependés de un dump ni de un formato propietario.

```bash
fly ssh console -C "node /app/scripts/backup.js /data"
fly ssh sftp get /data/etiquetado-XXX.db
```

Eso importa para dos cosas: si algún día hay que entregarle el sistema al cliente
o mudarlo a otro proveedor, te llevás el archivo y listo. Con un Postgres
administrado la portabilidad es bastante más trabajosa.

## Backups

Hay dos capas, y conviene tener las dos:

**Snapshots del volumen** — Fly los toma solos, a diario, y los guarda 5 días.
Se listan con `fly volumes snapshots list <id-del-volumen>`. Es la red de
seguridad automática.

**Copia consistente propia** — `scripts/backup.ts` usa `VACUUM INTO`, que escribe
una base nueva y completa mientras la app sigue funcionando. No alcanza con
copiar el archivo: con WAL activo, un `cp` puede agarrar un estado a medias
porque parte del commit vive en el `-wal`.

El script además **verifica el backup** con `integrity_check` y cuenta las
etiquetas: un backup que no se puede abrir no es un backup.

Para automatizarlo diario, un cron desde tu máquina o desde donde tengas
`flyctl`:

```bash
fly ssh console -C "node /app/scripts/backup.js /data/backups"
```

> Pendiente: subir los backups fuera de Fly (S3 o Cloudflare R2). Mientras estén
> solo en el volumen, comparten destino con lo que están respaldando.

## Migraciones

La app aplica los SQL de `drizzle/` **al arrancar**. En producción no se usa
`drizzle-kit push` porque adivina los cambios y puede borrar datos.

Cuando cambies el esquema:

```bash
npx drizzle-kit generate --name lo-que-cambiaste   # genera el SQL
git add drizzle/                                    # va al repo
fly deploy                                          # se aplica al arrancar
```

Si una migración falla, la app **no arranca** a propósito: es mejor que el deploy
se caiga que quedar arriba con la base a medias.

---

## Las dos consecuencias de estar en la nube

### 1. La impresora necesita un agente local

Un servidor en internet no puede alcanzar una IP `192.168.x.x`. Hace falta un
servicio corriendo en la planta que consulte la nube y le mande el ZPL a la
impresora — ver [`agente-impresion/`](agente-impresion/README.md).

Va en la **misma PC de la estación de etiquetado**, así que no hay hardware
extra. Pero conviene ser claro: **la nube no elimina el equipo en planta, lo hace
más chico.**

### 2. Sin internet no se puede etiquetar

Y no se puede arreglar con un buffer local. El número de caja lo asigna el
servidor porque tiene que haber **una sola autoridad** — es exactamente lo que
hace imposible tener dos cajas con el mismo número. Sin conexión no hay forma
segura de asignar números, y una etiqueta impresa sin número no sirve.

Es el costo de la decisión y hay que decirlo antes, no cuando pase.
