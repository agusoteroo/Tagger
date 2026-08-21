CREATE TABLE "auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" integer,
	"actor" text,
	"detalle" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuracion" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etiquetas" (
	"id" serial PRIMARY KEY NOT NULL,
	"lote_id" integer NOT NULL,
	"caja" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"operario_id" integer NOT NULL,
	"lote_codigo" text NOT NULL,
	"maquina_nombre" text NOT NULL,
	"frasco_nombre" text NOT NULL,
	"operario_nombre" text NOT NULL,
	"turno" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado_calidad" text DEFAULT 'pendiente' NOT NULL,
	"calidad_por" text,
	"calidad_en" timestamp with time zone,
	"calidad_nota" text,
	"anulada" boolean DEFAULT false NOT NULL,
	"anulada_por" text,
	"anulada_en" timestamp with time zone,
	"anulada_motivo" text,
	"impresiones" integer DEFAULT 0 NOT NULL,
	"ultima_impresion_en" timestamp with time zone,
	CONSTRAINT "uq_etiqueta_lote_caja" UNIQUE("lote_id","caja")
);
--> statement-breakpoint
CREATE TABLE "frascos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cantidad_estandar" integer,
	"prefijo_lote" text,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frascos_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "intentos_pin" (
	"id" serial PRIMARY KEY NOT NULL,
	"origen" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero" integer NOT NULL,
	"codigo" text NOT NULL,
	"maquina_id" integer NOT NULL,
	"frasco_id" integer NOT NULL,
	"maquina_nombre" text NOT NULL,
	"frasco_nombre" text NOT NULL,
	"limite" integer NOT NULL,
	"limite_unidad" text DEFAULT 'unidades' NOT NULL,
	"estado" text DEFAULT 'preparado' NOT NULL,
	"preparado_por" text,
	"preparado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"abierto_en" timestamp with time zone,
	"cerrado_en" timestamp with time zone,
	"cerrado_motivo" text,
	"cerrado_por" text,
	"nota" text,
	CONSTRAINT "uq_lote_frasco_numero" UNIQUE("frasco_id","numero")
);
--> statement-breakpoint
CREATE TABLE "maquinas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"frasco_id" integer,
	"lote_actual_id" integer,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maquinas_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "operarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operarios_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "turnos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "turnos_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
ALTER TABLE "etiquetas" ADD CONSTRAINT "etiquetas_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etiquetas" ADD CONSTRAINT "etiquetas_operario_id_operarios_id_fk" FOREIGN KEY ("operario_id") REFERENCES "public"."operarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_maquina_id_maquinas_id_fk" FOREIGN KEY ("maquina_id") REFERENCES "public"."maquinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_frasco_id_frascos_id_fk" FOREIGN KEY ("frasco_id") REFERENCES "public"."frascos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maquinas" ADD CONSTRAINT "maquinas_frasco_id_frascos_id_fk" FOREIGN KEY ("frasco_id") REFERENCES "public"."frascos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_auditoria_creado" ON "auditoria" USING btree ("creado_en");--> statement-breakpoint
CREATE INDEX "ix_etiquetas_lote" ON "etiquetas" USING btree ("lote_id");--> statement-breakpoint
CREATE INDEX "ix_etiquetas_creado" ON "etiquetas" USING btree ("creado_en");--> statement-breakpoint
CREATE INDEX "ix_etiquetas_estado" ON "etiquetas" USING btree ("estado_calidad");--> statement-breakpoint
CREATE INDEX "ix_intentos_origen" ON "intentos_pin" USING btree ("origen","creado_en");--> statement-breakpoint
CREATE INDEX "ix_lotes_maquina_estado" ON "lotes" USING btree ("maquina_id","estado");--> statement-breakpoint
CREATE INDEX "ix_lotes_estado" ON "lotes" USING btree ("estado");