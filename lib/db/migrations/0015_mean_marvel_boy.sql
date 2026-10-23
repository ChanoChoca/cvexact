CREATE TABLE "job_source_etag" (
	"key" text PRIMARY KEY NOT NULL,
	"etag" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_posting" ADD COLUMN "dedup_group_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "job_posting_dedup_group_id_idx" ON "job_posting" USING btree ("dedup_group_id");