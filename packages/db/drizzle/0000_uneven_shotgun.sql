CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_name" varchar(255),
	"phone" varchar(50),
	"active" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"intake_source" varchar(20) NOT NULL,
	"status" varchar(50) DEFAULT 'new' NOT NULL,
	"project_name" varchar(500),
	"sender_email" varchar(255),
	"sender_name" varchar(255),
	"sender_company" varchar(255),
	"email_subject" varchar(1000),
	"email_body" text,
	"raw_payload" jsonb,
	"external_ref" varchar(500),
	"validation_warnings" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_external_ref_unique" UNIQUE("external_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" uuid NOT NULL,
	"filename" varchar(500) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer,
	"document_type" varchar(50) DEFAULT 'other' NOT NULL,
	"storage_path" text,
	"content_hash" varchar(64),
	"processing_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"signal_id" varchar(100) NOT NULL,
	"extracted_value" text,
	"raw_value" text,
	"confidence" real,
	"extraction_method" varchar(50),
	"page_number" integer,
	"extraction_version" integer DEFAULT 1 NOT NULL,
	"source_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_fields_unique" UNIQUE("document_id","signal_id","extraction_version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"original_outcome" varchar(20) NOT NULL,
	"overridden_outcome" varchar(20) NOT NULL,
	"overridden_by" varchar(255) NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "go_no_go_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" uuid NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"total_score" real NOT NULL,
	"max_score" real NOT NULL,
	"score_percentage" real NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"explanation" text,
	"config_version" varchar(20),
	"decision_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_client_id_idx" ON "bids" ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_status_idx" ON "bids" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_received_at_idx" ON "bids" ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_documents_bid_id_idx" ON "bid_documents" ("bid_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_documents_processing_status_idx" ON "bid_documents" ("processing_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extracted_fields_document_id_idx" ON "extracted_fields" ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extracted_fields_bid_id_idx" ON "extracted_fields" ("bid_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extracted_fields_signal_id_idx" ON "extracted_fields" ("signal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_overrides_decision_id_idx" ON "decision_overrides" ("decision_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_overrides_bid_id_idx" ON "decision_overrides" ("bid_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_overrides_overridden_by_idx" ON "decision_overrides" ("overridden_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "go_no_go_decisions_bid_id_idx" ON "go_no_go_decisions" ("bid_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "go_no_go_decisions_outcome_idx" ON "go_no_go_decisions" ("outcome");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bids" ADD CONSTRAINT "bids_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_document_id_bid_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "bid_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_overrides" ADD CONSTRAINT "decision_overrides_decision_id_go_no_go_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "go_no_go_decisions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision_overrides" ADD CONSTRAINT "decision_overrides_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "go_no_go_decisions" ADD CONSTRAINT "go_no_go_decisions_bid_id_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
