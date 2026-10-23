CREATE TABLE "legal_request" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "legal_request_email_idx" ON "legal_request" USING btree ("email");--> statement-breakpoint
CREATE INDEX "legal_request_status_idx" ON "legal_request" USING btree ("status");