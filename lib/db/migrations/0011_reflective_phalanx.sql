CREATE TABLE "job_posting" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"work_mode" text DEFAULT 'unknown' NOT NULL,
	"seniority" text DEFAULT 'unknown' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"published_at" timestamp,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"can_prefill" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_posting_published_at_idx" ON "job_posting" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "job_posting_source_idx" ON "job_posting" USING btree ("source");