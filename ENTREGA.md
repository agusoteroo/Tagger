# Entrega al cliente

Son **dos entregas distintas** y conviene no mezclarlas. Hoy estamos en la
primera.

---

## Entrega 1 · Para que apruebe el flujo (ahora)

El objetivo no es que lo use: es que lo **toque y opine** antes de comprar
hardware. Todavía no hay impresora, así que el sistema no está terminado.

### Qué le mandás

```bash
npm run demo:preparar
```

Eso rota los PINs (los de la documentación no sirven para una URL pública), carga
producción de ejemplo y prende el banner de "ambiente de prueba". Te deja los
PINs nuevos en pantalla y en `PINS-DEMO.txt`.

Después, en dos terminales:

```bash
npm run build && npm start
```

```bash
cloudflared tunnel --url http://localhost:3000
```

Le pasás la URL que sale, los tres PINs, y el [MANUAL.md](MANUAL.md).

### Qué pedirle que valide

No le preguntes "¿te gusta?". Preguntale por lo que cuesta cambiar después:

- **El orden de los cuatro pasos** al etiquetar (máquina → operario → turno →
  cantidad). ¿Así trabajan, o primero eligen el turno?
- **El formulario de lote.** ¿El límite lo piensan en unidades o en cajas?
- **La numeración por producto.** ¿El lote 100 del 250ml y el 100 del 1L son dos
  lotes distintos para ellos, o esperaban un número único de planta?
- **Los cuatro roles.** ¿Quién abre lotes en la realidad? ¿Es la misma persona
  que dictamina calidad?
- **Qué falta en el reporte** que dirección vaya a pedir.

### Lo que le tenés que decir explícitamente

Dos cosas, porque después son excusas y ahora son decisiones:

1. **Los datos de la demo son inventados** y se van a borrar. No etiquetar cajas
   reales ahí.
2. **Falta la impresión.** Hoy imprime por el diálogo del navegador. Cuando llegue
   la impresora pasa a ser directo y de un toque.

---

## Entrega 2 · El sistema instalado (cuando esté la impresora)

### Checklist de instalación en planta

- [ ] Mini-PC con Node 22 y el proyecto instalado
- [ ] Base creada y sembrada con **los catálogos reales**: sus máquinas, sus
      productos con las unidades por caja, sus operarios, sus turnos
- [ ] **Los tres PINs cambiados** por los que elija el cliente
- [ ] `SESSION_SECRET` definido en `.env.local`
- [ ] `MODO_DEMO` apagado y `NODE_ENV=production`
- [ ] Impresora con IP fija en la LAN, `PRINTER_HOST` configurado
- [ ] Prueba de impresión real, con la etiqueta puesta en una caja
- [ ] Chrome en modo kiosko arrancando solo con la máquina
- [ ] Backup nocturno andando **y una restauración probada** (un backup que nunca
      se restauró no es un backup)
- [ ] Cloudflare Tunnel + Access para el acceso remoto
- [ ] Segundo mini-PC de repuesto con la imagen lista (opcional, ~$200, convierte
      una emergencia en veinte minutos)

### Qué se le entrega en mano

| Qué | A quién |
|---|---|
| [MANUAL.md](MANUAL.md) impreso, un capítulo por rol | Cada rol el suyo |
| La hoja del operario pegada al lado de la pantalla | Planta |
| Los tres PINs | Al referente, por un canal seguro. **No por WhatsApp ni mail** |
| La URL remota y cómo entrar | Dirección |
| Cómo pedir un backup y dónde quedan | Al referente de IT |
| [DESPLIEGUE.md](DESPLIEGUE.md) y [README.md](README.md) | A quien vaya a mantenerlo |

### Capacitación: media hora, tres charlas

**Operario (10 min, en la máquina).** Etiquetar tres cajas de verdad con él.
Mostrarle la barra de progreso y qué hacer si dice "sin lote abierto". Nada más:
su pantalla tiene cuatro toques.

**Jefe de planta (10 min).** Abrir un lote, y sobre todo **la cola**. Que entienda
que si no deja el siguiente preparado, la máquina se para cuando el actual se
llena. Es el error operativo más probable de todo el sistema.

**Calidad y Administración (10 min).** Dictaminar un lote, y generar un reporte
filtrado para que vean el recuadro que avisa que es parcial.

---

## Lo que hay que definir antes de entregar

Esto no es técnico y no lo puedo decidir yo.

**¿De quién es el código?** Hay tres formas y cambian qué entregás:

- **Licencia de uso.** Vos mantenés el código, ellos usan el sistema. Entregás el
  sistema funcionando, no el repositorio.
- **Código entregado.** Se lo pasás y pueden contratar a otro para modificarlo.
  Entregás el repo completo.
- **Desarrollo a medida con fuente en garantía.** Vos lo mantenés, pero el código
  queda depositado en algún lado para que ellos no dependan de vos si desaparecés.

**¿Quién lo mantiene y con qué acuerdo?** Actualizaciones, arreglos, cambios. Si
no queda por escrito, cualquier pedido futuro es una discusión.

**¿Quién es el dueño de los datos?** Acá es simple y conviene decirlo: la base es
**un archivo en una máquina de ellos**. Los datos son suyos y se los podés
entregar completos con un comando. Eso juega a favor tuyo en la conversación —
no los estás atando a una plataforma.

---

## Lo que NO le prometas todavía

- **Impresión automática.** Falta el paso 3, y necesita la impresora comprada.
- **Que funcione sin internet para consultar.** Etiquetar sí funciona sin
  internet (todo es local). Consultar desde afuera necesita el túnel arriba.
- **Backups afuera de la planta.** El script hace la copia y la verifica, pero
  todavía no la sube a ningún lado. Mientras esté solo en el mismo disco, comparte
  destino con lo que está respaldando.
