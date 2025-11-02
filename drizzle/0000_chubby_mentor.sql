CREATE TYPE "public"."driver_tier" AS ENUM('STANDARD', 'PREMIUM', 'ELITE');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('HELD', 'RELEASED', 'REFUNDED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DUE', 'PAID', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'CONFIRMED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('PAYMENT', 'DELIVERY_EARNINGS', 'REFUND', 'ESCROW_RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"permissions" jsonb DEFAULT '[]',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "admin_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"details" jsonb DEFAULT '{}',
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"commodity_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
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
CREATE TABLE "content_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" integer NOT NULL,
	"reported_user_id" integer,
	"reported_item_id" integer,
	"reported_item_type" text,
	"reason" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'PENDING',
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "delivery_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"feedback_type" text,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"vehicle_details" jsonb,
	"vehicle_type" text,
	"vehicle_plate" text,
	"vehicle_model" text,
	"vehicle_color" text,
	"license_number" text,
	"vehicle_registration" text,
	"driving_license" text,
	"current_location" jsonb,
	"verification_level" text,
	"background_check_status" text,
	"kyc_data" jsonb DEFAULT '{}',
	"tier" "driver_tier" DEFAULT 'STANDARD',
	"availability" boolean DEFAULT true,
	"is_available" boolean DEFAULT true,
	"is_online" boolean DEFAULT false,
	"verification_status" "verification_status" DEFAULT 'PENDING',
	"kyc_status" "kyc_status" DEFAULT 'PENDING',
	"kyc_approved_at" timestamp,
	"kyc_approved_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"error_type" text NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"request_url" text,
	"request_method" text,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "escrows" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"payer_id" integer NOT NULL,
	"payee_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" "escrow_status" DEFAULT 'HELD',
	"paystack_escrow_id" text,
	"transaction_ref" text,
	"release_date" timestamp,
	"released_at" timestamp,
	"dispute_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fraud_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"transaction_id" integer,
	"alert_type" text NOT NULL,
	"risk_level" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"driver_id" integer,
	"station_id" integer,
	"fuel_type" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price" numeric(10, 2),
	"total_amount" numeric(15, 2) NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_latitude" numeric(10, 8),
	"delivery_longitude" numeric(11, 8),
	"scheduled_delivery_time" timestamp,
	"estimated_delivery_time" timestamp,
	"notes" text,
	"status" "order_status" DEFAULT 'PENDING',
	"accepted_at" timestamp,
	"picked_up_at" timestamp,
	"delivered_at" timestamp,
	"confirmation_deadline" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"verification_type" text NOT NULL,
	"data" jsonb DEFAULT '{}',
	"status" "verification_status" DEFAULT 'PENDING',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
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
CREATE TABLE "merchant_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_name" text NOT NULL,
	"business_address" text,
	"business_type" text,
	"business_phone" text,
	"business_email" text,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"phone" text,
	"description" text,
	"operating_hours" jsonb DEFAULT '{}',
	"is_open" boolean DEFAULT true,
	"is_verified" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"verification_level" text DEFAULT 'BASIC',
	"background_check_status" text DEFAULT 'PENDING',
	"verification_status" "verification_status" DEFAULT 'PENDING',
	"kyc_status" "kyc_status" DEFAULT 'PENDING',
	"kyc_data" jsonb DEFAULT '{}',
	"kyc_approved_at" timestamp,
	"kyc_approved_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "merchant_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"order_id" integer,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mfa_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"method" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_used" boolean DEFAULT false,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moderation_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"admin_id" integer,
	"action" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer,
	"quantity" integer NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"subtotal" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"merchant_id" integer,
	"driver_id" integer,
	"order_type" text NOT NULL,
	"status" "order_status" DEFAULT 'PENDING',
	"total_amount" numeric(10, 2) NOT NULL,
	"driver_earnings" numeric(10, 2),
	"delivery_address" text NOT NULL,
	"pickup_address" text,
	"delivery_latitude" numeric(10, 8),
	"delivery_longitude" numeric(11, 8),
	"order_data" jsonb DEFAULT '{}',
	"accepted_at" timestamp,
	"picked_up_at" timestamp,
	"delivered_at" timestamp,
	"confirmation_deadline" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "positive_total_amount" CHECK ("orders"."total_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer,
	"seller_id" integer NOT NULL,
	"commodity_id" integer,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(15, 2) NOT NULL,
	"category_id" integer,
	"unit" text,
	"stock_quantity" integer DEFAULT 0,
	"stock_level" integer DEFAULT 0,
	"image_url" text,
	"images" jsonb DEFAULT '[]',
	"is_available" boolean DEFAULT true,
	"is_active" boolean DEFAULT true,
	"rating" numeric(3, 2) DEFAULT '0.00',
	"total_reviews" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "positive_price" CHECK ("products"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"rater_id" integer NOT NULL,
	"rated_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "security_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"success" boolean DEFAULT true,
	"details" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"order_id" integer,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" "support_status" DEFAULT 'OPEN',
	"priority" text DEFAULT 'MEDIUM',
	"category" text,
	"assigned_to" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "suspicious_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"activity_type" text NOT NULL,
	"description" text,
	"risk_score" integer,
	"ip_address" text,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "toll_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"fee" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"driver_id" integer,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"status" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"order_id" integer,
	"recipient_id" integer,
	"amount" numeric(15, 2) NOT NULL,
	"net_amount" numeric(15, 2),
	"currency" text DEFAULT 'NGN',
	"type" "transaction_type" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING',
	"payment_method" text,
	"payment_gateway_ref" text,
	"paystack_transaction_id" text,
	"transaction_ref" text NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}',
	"initiated_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "transactions_transaction_ref_unique" UNIQUE("transaction_ref")
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"device_name" text,
	"device_type" text,
	"is_active" boolean DEFAULT true,
	"last_used" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"firebase_uid" text,
	"email" text NOT NULL,
	"password" text,
	"full_name" text NOT NULL,
	"phone" text,
	"profile_picture" text,
	"role" "role" DEFAULT 'CONSUMER',
	"is_verified" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"mfa_enabled" boolean DEFAULT false,
	"mfa_method" text,
	"mfa_secret" text,
	"mfa_backup_codes" jsonb DEFAULT '[]',
	"biometric_hash" text,
	"biometric_type" text,
	"last_login_at" timestamp,
	"login_attempts" integer DEFAULT 0,
	"account_locked_until" timestamp,
	"average_rating" numeric(3, 2) DEFAULT '0.00',
	"total_ratings" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text,
	"document_url" text NOT NULL,
	"status" "verification_status" DEFAULT 'PENDING',
	"reviewed_by" integer,
	"review_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodities" ADD CONSTRAINT "commodities_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD CONSTRAINT "delivery_feedback_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD CONSTRAINT "delivery_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_kyc_approved_by_users_id_fk" FOREIGN KEY ("kyc_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_orders" ADD CONSTRAINT "fuel_orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_orders" ADD CONSTRAINT "fuel_orders_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_orders" ADD CONSTRAINT "fuel_orders_station_id_users_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_kyc_approved_by_users_id_fk" FOREIGN KEY ("kyc_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_tokens" ADD CONSTRAINT "mfa_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_responses" ADD CONSTRAINT "moderation_responses_report_id_content_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."content_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_commodity_id_commodities_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rated_id_users_id_fk" FOREIGN KEY ("rated_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_logs" ADD CONSTRAINT "security_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspicious_activities" ADD CONSTRAINT "suspicious_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking" ADD CONSTRAINT "tracking_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking" ADD CONSTRAINT "tracking_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_idx" ON "audit_logs" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cart_items_user_idx" ON "cart_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cart_items_commodity_idx" ON "cart_items" USING btree ("commodity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_user_commodity_unique_idx" ON "cart_items" USING btree ("user_id","commodity_id");--> statement-breakpoint
CREATE INDEX "categories_name_idx" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commodities_merchant_idx" ON "commodities" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "commodities_category_idx" ON "commodities" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "commodities_name_unique_idx" ON "commodities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "escrows_order_id_idx" ON "escrows" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_order_id_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "merchant_profiles_user_id_idx" ON "merchant_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_receiver_id_idx" ON "messages" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "mfa_tokens_user_id_idx" ON "mfa_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_merchant_id_idx" ON "orders" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "orders_driver_id_idx" ON "orders" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "products_merchant_id_idx" ON "products" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "products_seller_id_idx" ON "products" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "security_logs_user_id_idx" ON "security_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_logs_created_at_idx" ON "security_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tracking_order_id_idx" ON "tracking" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_order_id_idx" ON "transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "transactions_ref_idx" ON "transactions" USING btree ("transaction_ref");--> statement-breakpoint
CREATE INDEX "trusted_devices_user_id_idx" ON "trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_firebase_uid_idx" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "verification_documents_user_id_idx" ON "verification_documents" USING btree ("user_id");