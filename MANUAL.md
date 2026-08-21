# ENPLAS · Etiquetado — Manual de uso

Un capítulo por rol. Cada uno se lee en dos minutos.

---

## Para el operario

**No necesitás clave.** La pantalla de etiquetar está siempre disponible.

### Etiquetar una caja

Cuatro toques, en este orden:

1. **Máquina** — tocá la que estás usando
2. **Operario** — tu nombre
3. **Turno** — Mañana, Tarde o Noche
4. **Cantidad** — ya viene puesta la que corresponde al frasco. Si esta caja
   tiene otra cantidad, tocá *"Esta caja tiene otra cantidad"* y escribila

Después **Generar etiqueta** y **Imprimir**.

La máquina, el operario y el turno **quedan puestos** para la caja siguiente: solo
tenés que apretar Generar de nuevo.

### El número de caja lo pone el sistema

No lo elegís vos y no se puede repetir. Cada lote empieza en **#1**.

### Lo que vas a ver abajo del botón

Una barra que muestra cuánto falta para que se llene el lote:

```
Lote F250-17 · próxima caja #5
4 / 5 cajas — Falta 1 caja para cerrar el lote · 1 lote en cola
```

Cuando el lote se llena, **se cierra solo** y arranca el siguiente. La pantalla te
avisa y la numeración vuelve a #1. No tenés que hacer nada.

### Si dice "sin lote abierto"

La máquina no puede etiquetar. **Avisale al jefe de planta** para que abra el
lote siguiente. No es algo que puedas resolver desde la pantalla.

### Si te equivocaste en una caja

Avisá. Una etiqueta no se borra: se anula, y eso lo hace Administración con el
motivo anotado. El número de esa caja **no se reutiliza** — el salto en la
numeración queda como constancia de que ahí hubo una caja.

---

## Para el jefe de planta

Tu PIN abre la pestaña **Lotes**. También podés ver Eficiencia e Historial.

### Abrir un lote

En **Lotes**, botón *"Lote en [máquina]"*. Cargá:

- **Producto** — el frasco que va a hacer. Si es distinto al que venía haciendo,
  la máquina pasa a producir ese
- **Límite** — en unidades o en cajas, lo que te convenga. El formulario te
  muestra la equivalencia: si ponés 2400 unidades te dice "≈ 10 cajas de 240 u."
- **Nota** (opcional) — sirve para anotar la partida de materia prima

**El número de lote lo pone el sistema.** No lo escribís. Cada producto lleva su
propia numeración: el lote 100 del 250ml y el 100 del 1L son dos lotes distintos.

### La cola: lo más importante de tu pantalla

Si la máquina ya está produciendo, el lote nuevo **queda en cola**. Cuando el
actual llega a su límite, se cierra solo y el de la cola arranca automáticamente.

**Dejá siempre el siguiente preparado.** Si un lote se llena y no hay otro en
cola, **la máquina queda parada** hasta que vayas a abrir uno. La pantalla te
avisa con un cartel rojo y el número aparece en la pestaña Lotes.

### Cerrar un lote antes del límite

Botón **Cerrar** en la tarjeta del lote. Arranca el de la cola, si hay.

### Cancelar un lote de la cola

El tacho de basura en la fila. No se borra: queda registrado como cancelado, y
**su número no se reutiliza**.

### Si una caja se pasa del límite

Se etiqueta igual y ahí se cierra el lote. Es a propósito: esa caja existe de
verdad, y dejarla sin registrar sería peor que pasarse por una. El excedente
queda visible en la lista de lotes cerrados.

---

## Para Calidad

Tu PIN abre la pestaña **Calidad**. También podés ver Eficiencia e Historial.

### Dictaminar

1. Filtrá por lote si querés trabajar de a uno
2. Tocá las filas de las cajas que revisaste (o *Seleccionar todo*)
3. Poné **tu nombre** en "Responsable de Calidad"
4. **Liberar** o **Rechazar**

La nota es opcional pero queda en el historial y en el reporte. Vale la pena
usarla cuando rechazás.

### El número de la pestaña

El contador rojo son las cajas **pendientes de dictamen**. Mientras haya
pendientes, esas cajas no cuentan como liberadas en ningún reporte.

### Qué significa cada estado

| | |
|---|---|
| **Pendiente** | Todavía no la revisaste |
| **Liberada** | Aprobada, con tu nombre y la fecha |
| **Rechazada** | No pasó. Sigue contando como producida, pero marcada |

Nada de esto borra la caja. Los tres estados quedan en el historial con quién
dictaminó y cuándo.

---

## Para Administración

Tu PIN abre todo, incluida **Configuración**.

### Lo primero: cambiar los tres PINs

**Configuración → PINs.** Los que vienen de fábrica están escritos en la
documentación, así que no sirven. Los tres tienen que ser distintos entre sí.

### Alta de máquinas, productos, operarios y turnos

Todo en **Configuración**. Dos cosas a tener en cuenta:

**La cantidad estándar del frasco** es lo que se completa solo al etiquetar. Si
la cargás bien, el operario no tipea números y no se equivoca.

**Los operarios no se borran si ya produjeron.** Se desactivan: salen de la
pantalla de etiquetado y su historial queda intacto. Borrarlos rompería la
trazabilidad de esas cajas.

### Anular una etiqueta

Solo vos podés. Ícono del tacho en el Historial. Pide **motivo obligatorio** y
queda auditado con tu nombre. La fila no se borra y el número de caja no se
reutiliza.

### El reporte para dirección

**Eficiencia → Generar reporte.** Baja un archivo HTML con todo lo que estás
viendo, respetando los filtros que tengas puestos. Se manda por mail o WhatsApp
y se abre en cualquier computadora o celular, **sin internet**.

Si el reporte tiene algún filtro puesto, lo aclara arriba en un recuadro. Presta
atención a eso: un reporte filtrado a un solo operario no se puede leer como si
fuera de toda la planta.

### Exportar a Excel

**Historial → Exportar** o **Eficiencia → Exportar CSV.** Sale con los mismos
filtros que la pantalla, así que el archivo siempre coincide con lo que se ve.

---

## Cosas que valen para todos

**La pantalla se bloquea sola** a los 5 minutos sin uso y vuelve a la pantalla de
etiquetar. Es para que no quede abierta con permisos de administrador si alguien
se va de la estación.

**Nada se borra, nunca.** Anular, rechazar y cancelar son estados, no borrados.
Todo queda con quién lo hizo y cuándo.

**Las reimpresiones quedan registradas.** Reimprimir una etiqueta es normal (se
mojó, se arrugó), pero el sistema cuenta cuántas veces se imprimió cada una.
