CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"from_name" text NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"username" text NOT NULL,
	"secret" text NOT NULL,
	"daily_limit" integer DEFAULT 40 NOT NULL,
	"warmup" boolean DEFAULT true NOT NULL,
	"warmup_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_detail" text,
	"last_polled_at" timestamp with time zone,
	"last_uid" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"scope" text DEFAULT '*' NOT NULL,
	"dimension" text,
	"value" text,
	"confidence" text DEFAULT 'preliminary' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"mailbox_id" uuid,
	"from_email" text,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"message_id_header" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "mailbox_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "sequence_stopped_reason" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "status" text DEFAULT 'requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "follow_ups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "traits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_email_uq" ON "mailboxes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_key_uq" ON "memory_entries" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_assignment_step_uq" ON "outbound_messages" USING btree ("assignment_id","step");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_provider_uq" ON "outbound_messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "outbound_sent_idx" ON "outbound_messages" USING btree ("sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_assignment_uq" ON "meetings" USING btree ("assignment_id");