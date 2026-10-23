CREATE TABLE "job_source_budget" (
	"source" text PRIMARY KEY NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
