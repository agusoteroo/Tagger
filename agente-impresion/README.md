# Agente de impresión

Servicio chico que corre **en la planta** y le manda las etiquetas a la
impresora.

## Por qué existe

La app está en la nube. La impresora está en la LAN de la fábrica, en una IP
como `192.168.1.50`. **Un servidor en internet no puede alcanzarla** — no hay
ruta desde afuera hacia la red interna.

Este agente resuelve eso sin abrir puertos ni tocar el router: **él consulta
hacia afuera**, no recibe conexiones.

```
   NUBE (Fly.io)                        PLANTA
┌──────────────────┐
│  app + base      │◄──── consulta ────┐
│                  │                   │
│  cola de         │──── etiquetas ───►│  AGENTE (esta PC)
│  impresión       │      pendientes   │        │
└──────────────────┘                   │        │ TCP :9100
                                       │        ▼
                                       │   IMPRESORA (LAN)
```

El agente pregunta cada segundo "¿hay algo para imprimir?", recibe el ZPL ya
armado, lo manda a la impresora por TCP y avisa que salió. Si la impresora está
apagada o se traba, el trabajo queda pendiente y se reintenta.

## Dónde corre

En la **misma PC de la estación de etiquetado**, la que tiene la pantalla
táctil. No hace falta hardware extra: si esa máquina está prendida el operario
está trabajando, y si está apagada no hay nada que imprimir.

Funciona igual en Windows o en Linux (por si más adelante pasa a una Raspberry).

## Instalar

```bash
cd agente-impresion
npm install
```

Copiá `.env.example` a `.env` y completá:

```
API_URL=https://enplas-etiquetado.fly.dev
AGENTE_TOKEN=            # el mismo que esté configurado en el servidor
PRINTER_HOST=192.168.1.50
PRINTER_PORT=9100
```

Probar que llega a la impresora, antes que nada:

```bash
npm run probar
```

Eso manda una etiqueta de prueba. Si sale impresa, el resto va a funcionar.

Después, dejarlo corriendo:

```bash
npm start
```

## Que arranque solo con Windows

Para que no dependa de que alguien lo abra a mano:

```powershell
schtasks /create /tn "ENPLAS Agente Impresion" /tr "cmd /c cd /d C:\ruta\agente-impresion && npm start" /sc onstart /ru SYSTEM /rl HIGHEST
```

## Estado

**Pendiente.** El agente se escribe en el paso 3, cuando esté la impresora y se
sepa el modelo. Lo que está definido es la arquitectura y el contrato con el
servidor: el agente hace *polling* saliente, así que no necesita IP fija, ni
puertos abiertos, ni configuración de red en la fábrica.
