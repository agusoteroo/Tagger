-- El lote ya no se cierra por cantidad: se cierra cuando en esa maquina arranca
-- otro lote. Eso elimina el estado 'preparado' y la cola de lotes que esperaban
-- para arrancar solos.
--
-- 1. Los 'preparado' que quedaron nunca van a arrancar: nada los activa. Se
--    cierran como 'cancelado' para que no queden en un estado que el sistema ya
--    no entiende. El numero NO se reusa: el hueco es la evidencia de que
--    existieron.
UPDATE "lotes"
   SET "estado" = 'cerrado',
       "cerrado_motivo" = 'cancelado',
       "cerrado_en" = now(),
       "cerrado_por" = 'migracion 0001'
 WHERE "estado" = 'preparado';--> statement-breakpoint

-- 2. Un lote nace abierto: cargarlo es arrancarlo.
ALTER TABLE "lotes" ALTER COLUMN "estado" SET DEFAULT 'abierto';--> statement-breakpoint

-- 3. UNA maquina, UN lote abierto. Garantizado por la base, no asumido: si
--    hubiera dos, abrirLote cerraria uno y dejaria el otro produciendo cajas en
--    un lote que nadie mira.
CREATE UNIQUE INDEX "uq_lote_abierto_por_maquina" ON "lotes" USING btree ("maquina_id") WHERE "lotes"."estado" = 'abierto';