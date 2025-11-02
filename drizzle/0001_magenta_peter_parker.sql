CREATE TYPE "public"."invoice_status" AS ENUM('DUE', 'PAID', 'OVERDUE');--> statement-breakpoint
CREATE TABLE "commodities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"merchant_id" integer NOT NULL,
	"category" text,
	"image_url" text,
	"stock_quantity" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'DUE',
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
ALTER TABLE "account_flags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_payment_actions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance_documents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_confirmations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_verifications" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jwt_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_locations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "account_flags" CASCADE;--> statement-breakpoint
DROP TABLE "admin_payment_actions" CASCADE;--> statement-breakpoint
DROP TABLE "compliance_documents" CASCADE;--> statement-breakpoint
DROP TABLE "conversations" CASCADE;--> statement-breakpoint
DROP TABLE "delivery_confirmations" CASCADE;--> statement-breakpoint
DROP TABLE "driver_verifications" CASCADE;--> statement-breakpoint
DROP TABLE "jwt_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "payment_methods" CASCADE;--> statement-breakpoint
DROP TABLE "user_locations" CASCADE;--> statement-breakpoint
ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_ticket_number_unique";--> statement-breakpoint
ALTER TABLE "trusted_devices" DROP CONSTRAINT "trusted_devices_device_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_paystack_recipient_code_unique";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP CONSTRAINT "valid_driver_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP CONSTRAINT "valid_service_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP CONSTRAINT "valid_delivery_time_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP CONSTRAINT "valid_customer_rating";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP CONSTRAINT "positive_earnings";--> statement-breakpoint
ALTER TABLE "escrows" DROP CONSTRAINT "positive_amount";--> statement-breakpoint
ALTER TABLE "fuel_orders" DROP CONSTRAINT "positive_quantity";--> statement-breakpoint
ALTER TABLE "fuel_orders" DROP CONSTRAINT "positive_unit_price";--> statement-breakpoint
ALTER TABLE "fuel_orders" DROP CONSTRAINT "positive_total_amount";--> statement-breakpoint
ALTER TABLE "merchant_profiles" DROP CONSTRAINT "positive_revenue";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "valid_rating";--> statement-breakpoint
ALTER TABLE "toll_gates" DROP CONSTRAINT "positive_price";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "positive_amount";--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_reported_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP CONSTRAINT "delivery_feedback_customer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP CONSTRAINT "delivery_feedback_driver_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "fraud_alerts" DROP CONSTRAINT "fraud_alerts_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP CONSTRAINT "identity_verifications_reviewed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_support_ticket_id_support_tickets_id_fk";
--> statement-breakpoint
ALTER TABLE "moderation_responses" DROP CONSTRAINT "moderation_responses_admin_id_admin_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_customer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_driver_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_merchant_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP CONSTRAINT "suspicious_activities_investigated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."transaction_type";--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('PAYMENT', 'DELIVERY_EARNINGS', 'REFUND', 'ESCROW_RELEASE');--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "type" SET DATA TYPE "public"."transaction_type" USING "type"::"public"."transaction_type";--> statement-breakpoint
DROP INDEX "admin_users_user_id_idx";--> statement-breakpoint
DROP INDEX "content_reports_reported_by_idx";--> statement-breakpoint
DROP INDEX "content_reports_content_type_idx";--> statement-breakpoint
DROP INDEX "delivery_feedback_order_id_idx";--> statement-breakpoint
DROP INDEX "delivery_feedback_customer_id_idx";--> statement-breakpoint
DROP INDEX "delivery_feedback_driver_id_idx";--> statement-breakpoint
DROP INDEX "driver_profiles_user_id_idx";--> statement-breakpoint
DROP INDEX "error_logs_user_id_idx";--> statement-breakpoint
DROP INDEX "error_logs_severity_idx";--> statement-breakpoint
DROP INDEX "escrows_payer_id_idx";--> statement-breakpoint
DROP INDEX "escrows_payee_id_idx";--> statement-breakpoint
DROP INDEX "fraud_alerts_user_id_idx";--> statement-breakpoint
DROP INDEX "fraud_alerts_transaction_id_idx";--> statement-breakpoint
DROP INDEX "fraud_alerts_order_id_idx";--> statement-breakpoint
DROP INDEX "fuel_orders_customer_id_idx";--> statement-breakpoint
DROP INDEX "fuel_orders_driver_id_idx";--> statement-breakpoint
DROP INDEX "identity_verifications_user_id_idx";--> statement-breakpoint
DROP INDEX "messages_order_id_idx";--> statement-breakpoint
DROP INDEX "messages_support_ticket_id_idx";--> statement-breakpoint
DROP INDEX "mfa_tokens_token_idx";--> statement-breakpoint
DROP INDEX "moderation_responses_report_id_idx";--> statement-breakpoint
DROP INDEX "moderation_responses_admin_id_idx";--> statement-breakpoint
DROP INDEX "ratings_customer_id_idx";--> statement-breakpoint
DROP INDEX "ratings_order_id_idx";--> statement-breakpoint
DROP INDEX "ratings_driver_id_idx";--> statement-breakpoint
DROP INDEX "ratings_merchant_id_idx";--> statement-breakpoint
DROP INDEX "ratings_product_id_idx";--> statement-breakpoint
DROP INDEX "security_logs_event_type_idx";--> statement-breakpoint
DROP INDEX "support_tickets_ticket_number_idx";--> statement-breakpoint
DROP INDEX "suspicious_activities_user_id_idx";--> statement-breakpoint
DROP INDEX "suspicious_activities_activity_type_idx";--> statement-breakpoint
DROP INDEX "toll_gates_name_idx";--> statement-breakpoint
DROP INDEX "tracking_driver_id_idx";--> statement-breakpoint
DROP INDEX "transactions_paystack_idx";--> statement-breakpoint
DROP INDEX "trusted_devices_device_id_idx";--> statement-breakpoint
DROP INDEX "users_paystack_recipient_idx";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "entity_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ALTER COLUMN "feedback_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ALTER COLUMN "feedback_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_profiles" ALTER COLUMN "vehicle_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "driver_profiles" ALTER COLUMN "vehicle_plate" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "driver_profiles" ALTER COLUMN "vehicle_model" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "driver_profiles" ALTER COLUMN "current_location" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "driver_profiles" ALTER COLUMN "verification_level" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "driver_profiles" ALTER COLUMN "background_check_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "fuel_orders" ALTER COLUMN "station_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "fuel_orders" ALTER COLUMN "station_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_orders" ALTER COLUMN "unit_price" SET DATA TYPE numeric(10, 2);--> statement-breakpoint
ALTER TABLE "fuel_orders" ALTER COLUMN "unit_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_orders" ALTER COLUMN "scheduled_delivery_time" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "fuel_orders" ALTER COLUMN "estimated_delivery_time" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "moderation_responses" ALTER COLUMN "admin_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "price" SET DATA TYPE numeric(15, 2);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "subtotal" SET DATA TYPE numeric(15, 2);--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "suspicious_activities" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "toll_gates" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "toll_gates" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tracking" ALTER COLUMN "latitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracking" ALTER COLUMN "longitude" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "transaction_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_documents" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."verification_status";--> statement-breakpoint
ALTER TABLE "verification_documents" ALTER COLUMN "status" SET DATA TYPE "public"."verification_status" USING "status"::"public"."verification_status";--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "commodity_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "reporter_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "reported_user_id" integer;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "reported_item_id" integer;--> statement-breakpoint
ALTER TABLE "content_reports" ADD COLUMN "reported_item_type" text;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD COLUMN "user_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD COLUMN "rating" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "vehicle_details" jsonb;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "driving_license" text;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD COLUMN "availability" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "error_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "error_message" text NOT NULL;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "stack_trace" text;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "request_url" text;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "request_method" text;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "escrows" ADD COLUMN "release_date" timestamp;--> statement-breakpoint
ALTER TABLE "escrows" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "escrows" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD COLUMN "alert_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD COLUMN "risk_level" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD COLUMN "verification_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD COLUMN "verification_data" jsonb DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD COLUMN "status" "verification_status" DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "moderation_responses" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "commodity_id" integer;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "rater_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "rated_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "security_logs" ADD COLUMN "success" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "security_logs" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "order_id" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "subject" text NOT NULL;--> statement-breakpoint
ALTER TABLE "suspicious_activities" ADD COLUMN "risk_score" integer;--> statement-breakpoint
ALTER TABLE "suspicious_activities" ADD COLUMN "metadata" jsonb DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "suspicious_activities" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "toll_gates" ADD COLUMN "fee" numeric(10, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD COLUMN "last_used" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firebase_uid" text;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD COLUMN "document_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "commodities" ADD CONSTRAINT "commodities_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commodities_merchant_idx" ON "commodities" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "commodities_category_idx" ON "commodities" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "commodities_name_unique_idx" ON "commodities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "invoices_order_id_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD CONSTRAINT "delivery_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_orders" ADD CONSTRAINT "fuel_orders_station_id_users_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cart_items_user_idx" ON "cart_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cart_items_commodity_idx" ON "cart_items" USING btree ("commodity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_commodity_unique_idx" ON "cart_items" USING btree ("user_id","commodity_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "security_logs_created_at_idx" ON "security_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_firebase_uid_idx" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "department";--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "last_active_at";--> statement-breakpoint
ALTER TABLE "cart_items" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "content_reports" DROP COLUMN "reported_by";--> statement-breakpoint
ALTER TABLE "content_reports" DROP COLUMN "content_type";--> statement-breakpoint
ALTER TABLE "content_reports" DROP COLUMN "content_id";--> statement-breakpoint
ALTER TABLE "content_reports" DROP COLUMN "resolved_at";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "customer_id";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "driver_id";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "driver_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "service_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "delivery_time_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "delivery_quality";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "would_recommend";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "issues_reported";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "customer_rating";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "delivery_complexity";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "customer_cooperation";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "payment_issues";--> statement-breakpoint
ALTER TABLE "delivery_feedback" DROP COLUMN "additional_feedback";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "current_latitude";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "current_longitude";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "rating";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "total_ratings";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "total_deliveries";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "total_earnings";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "average_delivery_time";--> statement-breakpoint
ALTER TABLE "driver_profiles" DROP COLUMN "kyc_submitted_at";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "message";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "stack";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "user_agent";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "severity";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "timestamp";--> statement-breakpoint
ALTER TABLE "error_logs" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "escrows" DROP COLUMN "cancelled_at";--> statement-breakpoint
ALTER TABLE "fraud_alerts" DROP COLUMN "order_id";--> statement-breakpoint
ALTER TABLE "fraud_alerts" DROP COLUMN "reason";--> statement-breakpoint
ALTER TABLE "fraud_alerts" DROP COLUMN "severity";--> statement-breakpoint
ALTER TABLE "fraud_alerts" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "document_type";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "document_number";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "document_image_url";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "verification_status";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "submitted_at";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "reviewed_at";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "reviewed_by";--> statement-breakpoint
ALTER TABLE "identity_verifications" DROP COLUMN "rejection_reason";--> statement-breakpoint
ALTER TABLE "merchant_profiles" DROP COLUMN "rating";--> statement-breakpoint
ALTER TABLE "merchant_profiles" DROP COLUMN "total_orders";--> statement-breakpoint
ALTER TABLE "merchant_profiles" DROP COLUMN "revenue";--> statement-breakpoint
ALTER TABLE "merchant_profiles" DROP COLUMN "kyc_submitted_at";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "support_ticket_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "mfa_tokens" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "moderation_responses" DROP COLUMN "response";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "customer_id";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "driver_id";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "merchant_id";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "security_logs" DROP COLUMN "event_type";--> statement-breakpoint
ALTER TABLE "security_logs" DROP COLUMN "severity";--> statement-breakpoint
ALTER TABLE "security_logs" DROP COLUMN "timestamp";--> statement-breakpoint
ALTER TABLE "security_logs" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP COLUMN "ticket_number";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP COLUMN "attachments";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP COLUMN "resolved_at";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "risk_level";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "risk_indicators";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "timestamp";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "device_fingerprint";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "severity";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "investigated_by";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "investigated_at";--> statement-breakpoint
ALTER TABLE "suspicious_activities" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "toll_gates" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "toll_gates" DROP COLUMN "operating_hours";--> statement-breakpoint
ALTER TABLE "tracking" DROP COLUMN "timestamp";--> statement-breakpoint
ALTER TABLE "trusted_devices" DROP COLUMN "browser_info";--> statement-breakpoint
ALTER TABLE "trusted_devices" DROP COLUMN "last_used_at";--> statement-breakpoint
ALTER TABLE "trusted_devices" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "paystack_recipient_code";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "bank_name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_number";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_name";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "file_name";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "file_size";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "mime_type";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "expiry_date";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "validation_score";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "extracted_data";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "rejection_reason";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "reviewed_at";--> statement-breakpoint
ALTER TABLE "verification_documents" DROP COLUMN "uploaded_at";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid");