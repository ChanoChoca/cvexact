ALTER TABLE "credit_purchase" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_purchase" ADD COLUMN "forfeited_credits" integer DEFAULT 0 NOT NULL;