CREATE TABLE "invoice" (
	"gateway" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text,
	"pto_vta" integer NOT NULL,
	"cbte_tipo" integer NOT NULL,
	"cbte_nro" integer,
	"cae" text,
	"cae_vto" timestamp,
	"importe" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"issued_at" timestamp,
	CONSTRAINT "invoice_gateway_external_id_pk" PRIMARY KEY("gateway","external_id")
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;