CREATE TABLE "application_tombstone" (
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "application_tombstone_user_id_application_id_pk" PRIMARY KEY("user_id","application_id")
);
--> statement-breakpoint
ALTER TABLE "application_tombstone" ADD CONSTRAINT "application_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_tombstone_user_id_idx" ON "application_tombstone" USING btree ("user_id");