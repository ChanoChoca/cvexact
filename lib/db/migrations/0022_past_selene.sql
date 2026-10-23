CREATE TABLE "generation_result" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"body_hash" text NOT NULL,
	"status" text NOT NULL,
	"ciphertext" text,
	"iv" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "generation_result_expires_idx" ON "generation_result" USING btree ("expires_at");