CREATE TABLE "application_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"name" text,
	"email" text,
	"role" text,
	"linkedin_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_event" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"detected_from" text DEFAULT 'manual' NOT NULL,
	"confidence" real,
	"raw_sender" text,
	"raw_subject" text,
	"body" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"user_id" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"kind" text NOT NULL,
	"message" text,
	"sent_at" timestamp,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cv_version" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"alias" text NOT NULL,
	"verified_at" timestamp,
	"consent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_inbox_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "email_inbox_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "company_norm" text GENERATED ALWAYS AS (lower(regexp_replace(coalesce(company, ''), '[^a-zA-Z0-9]', '', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "job_posting_id" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "job_url" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "jd_text" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "jd_jsonld" jsonb;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "remote" boolean;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "salary_min" integer;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "salary_max" integer;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "status" text DEFAULT 'guardado' NOT NULL;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "applied_at" timestamp;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "last_activity_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "cv_version_id" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "board_position" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_contact" ADD CONSTRAINT "application_contact_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reminder" ADD CONSTRAINT "application_reminder_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_reminder" ADD CONSTRAINT "application_reminder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_version" ADD CONSTRAINT "cv_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_inbox" ADD CONSTRAINT "email_inbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_contact_application_id_idx" ON "application_contact" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_event_application_occurred_idx" ON "application_event" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE INDEX "application_reminder_due_idx" ON "application_reminder" USING btree ("due_at") WHERE "application_reminder"."sent_at" is null and not "application_reminder"."dismissed";--> statement-breakpoint
CREATE INDEX "cv_version_user_id_idx" ON "cv_version" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cv_version_user_fingerprint_idx" ON "cv_version" USING btree ("user_id","fingerprint");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_job_posting_id_job_posting_id_fk" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_posting"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_cv_version_id_cv_version_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_user_status_idx" ON "application" USING btree ("user_id","status") WHERE not "application"."archived";--> statement-breakpoint
CREATE INDEX "application_user_last_activity_idx" ON "application" USING btree ("user_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "application_user_company_title_idx" ON "application" USING btree ("user_id","company_norm","job_title");