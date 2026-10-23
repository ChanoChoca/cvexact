CREATE TABLE "job_alert" (
	"user_id" text PRIMARY KEY NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"work_mode" text DEFAULT '' NOT NULL,
	"min_score" integer DEFAULT 60 NOT NULL,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"last_sent_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_alert" ADD CONSTRAINT "job_alert_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;