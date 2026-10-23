CREATE TABLE "credit_purchase" (
	"gateway" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credits" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_purchase_gateway_external_id_pk" PRIMARY KEY("gateway","external_id")
);
--> statement-breakpoint
CREATE TABLE "generation_usage" (
	"day" text NOT NULL,
	"action" text NOT NULL,
	"tier" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"reasoning_tokens" bigint DEFAULT 0 NOT NULL,
	"repairs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "generation_usage_day_action_tier_provider_model_id_pk" PRIMARY KEY("day","action","tier","provider","model_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_purchase" ADD CONSTRAINT "credit_purchase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;