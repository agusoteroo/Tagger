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

Una barra con cuánto lleva el lote contra lo planificado:

```
Lote F250-17 · próxima caja #5
4 / 5 cajas — Falta 1 caja para el objetivo
```

Cuando llega al objetivo, dice **"Objetivo cumplido"** y **seguís etiquetando
igual**. El lote no se cierra por cantidad: si la planta hizo más de lo
planificado, se registra y listo. Vas a ver el porcentaje pasar de 100%, y eso
está bien.

El lote se cierra cuando **el jefe carga otro lote en esa máquina** — o sea
cuando la máquina se pone a hacer otra cosa. Ahí la numeración vuelve a #1 y la
pantalla te lo avisa.

### Si dice "sin lote abierto"

La máquina no puede etiquetar. **Avisale al jefe de planta** para que abra un
lote. No es algo que puedas resolver desde la pantalla.

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
- **Objetivo** — cuánto pensás producir, en unidades o en cajas. El formulario te
  muestra la equivalencia: si ponés 2400 unidades te dice "≈ 10 cajas de 240 u."
  Es una referencia para medir, **no un tope**: si se pasa, se sigue etiquetando
- **Nota** (opcional) — sirve para anotar la partida de materia prima

**El número de lote lo pone el sistema.** No lo escribís. Cada producto lleva su
propia numeración: el lote 100 del 250ml y el 100 del 1L son dos lotes distintos.

### Lo más importante de tu pantalla: cargar un lote CIERRA el anterior

Si la máquina venía produciendo, el lote nuevo arranca **en el acto** y el que
estaba **se cierra en ese momento**.

Es la lógica de la planta: si estás haciendo frascos de 250 y cargás un lote de
potes de 100 en esa máquina, el lote de 250 terminó ahí — haya hecho el 40% o el
180% de lo planificado. Antes de confirmar, la pantalla te dice cuál vas a cerrar
y con cuánto va, así no te llevás una sorpresa.

**Pasa también si es el mismo producto.** Una máquina tiene un lote a la vez, sin
excepciones. Si cargaste uno por error, cerralo y abrí el correcto: no hay forma
de "deshacerlo", pero queda todo registrado.

**El lote NO se cierra por llegar al objetivo.** La máquina sigue produciendo
hasta que vos decidas cambiar. No hace falta dejar nada preparado y la línea no
se detiene sola.

### Cerrar un lote sin abrir otro

Botón **Cerrar** en la tarjeta del lote. Ojo: la máquina **queda parada** y no se
puede etiquetar hasta que abras uno nuevo. Usalo para cortar turno o parar por
mantenimiento; si lo que querés es cambiar de producto, cargá directamente el
lote nuevo y este se cierra solo.

### Si se pasa del objetivo

No pasa nada malo: se sigue etiquetando y el excedente queda medido. Lo vas a ver
como un porcentaje arriba de 100 y en la lista de lotes cerrados. Es información
útil — te dice dónde se produjo de más.

### Si te equivocaste con el objetivo

Se puede corregir con el lote abierto, incluso dejándolo por debajo de lo que ya
se produjo. No cierra nada: solo cambia el número contra el que se compara.

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
