CREATE TYPE "public"."driver_tier" AS ENUM('STANDARD', 'PREMIUM', 'ELITE');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('HELD', 'RELEASED', 'REFUNDED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'CONFIRMED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('PAYMENT', 'DELIVERY_EARNINGS', 'REFUND', 'ESCROW_RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "account_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"flag_type" text NOT NULL,
	"reason" text NOT NULL,
	"severity" text DEFAULT 'MEDIUM',
	"status" text DEFAULT 'ACTIVE',
	"flagged_by" integer NOT NULL,
	"resolved_by" integer,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "admin_payment_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"transaction_id" integer,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(15, 2),
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"permissions" jsonb DEFAULT '[]',
	"department" text,
	"is_active" boolean DEFAULT true,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "admin_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text,
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
	"product_id" integer NOT NULL,
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
CREATE TABLE "compliance_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_url" text NOT NULL,
	"status" "kyc_status" DEFAULT 'PENDING',
	"expiry_date" timestamp,
	"submitted_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp,
	"reviewed_by" integer,
	"rejection_reason" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reported_by" integer NOT NULL,
	"content_type" text NOT NULL,
	"content_id" integer NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'PENDING',
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"support_agent_id" integer,
	"subject" text NOT NULL,
	"status" text DEFAULT 'OPEN',
	"priority" text DEFAULT 'MEDIUM',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "delivery_confirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"driver_confirmed" boolean DEFAULT false,
	"consumer_confirmed" boolean DEFAULT false,
	"confirmation_deadline" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "delivery_confirmations_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"feedback_type" varchar(50) NOT NULL,
	"driver_rating" integer,
	"service_rating" integer,
	"delivery_time_rating" integer,
	"delivery_quality" varchar(20),
	"would_recommend" boolean,
	"issues_reported" text,
	"customer_rating" integer,
	"delivery_complexity" varchar(20),
	"customer_cooperation" varchar(20),
	"payment_issues" boolean,
	"comment" text,
	"additional_feedback" text,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "valid_driver_rating" CHECK ("delivery_feedback"."driver_rating" IS NULL OR ("delivery_feedback"."driver_rating" >= 1 AND "delivery_feedback"."driver_rating" <= 5)),
	CONSTRAINT "valid_service_rating" CHECK ("delivery_feedback"."service_rating" IS NULL OR ("delivery_feedback"."service_rating" >= 1 AND "delivery_feedback"."service_rating" <= 5)),
	CONSTRAINT "valid_delivery_time_rating" CHECK ("delivery_feedback"."delivery_time_rating" IS NULL OR ("delivery_feedback"."delivery_time_rating" >= 1 AND "delivery_feedback"."delivery_time_rating" <= 5)),
	CONSTRAINT "valid_customer_rating" CHECK ("delivery_feedback"."customer_rating" IS NULL OR ("delivery_feedback"."customer_rating" >= 1 AND "delivery_feedback"."customer_rating" <= 5))
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"vehicle_type" varchar(50),
	"vehicle_plate" varchar(20),
	"vehicle_model" varchar(100),
	"vehicle_color" text,
	"license_number" text,
	"vehicle_registration" text,
	"current_latitude" numeric(10, 8),
	"current_longitude" numeric(11, 8),
	"is_online" boolean DEFAULT false,
	"is_available" boolean DEFAULT true,
	"current_location" text,
	"rating" numeric(3, 2) DEFAULT '0.00',
	"total_ratings" integer DEFAULT 0,
	"total_deliveries" integer DEFAULT 0,
	"total_earnings" numeric(15, 2) DEFAULT '0.00',
	"average_delivery_time" integer,
	"verification_status" "verification_status" DEFAULT 'PENDING',
	"tier" "driver_tier" DEFAULT 'STANDARD',
	"kyc_data" jsonb DEFAULT '{}',
	"kyc_status" "kyc_status" DEFAULT 'PENDING',
	"kyc_submitted_at" timestamp,
	"kyc_approved_at" timestamp,
	"kyc_approved_by" integer,
	"verification_level" text DEFAULT 'BASIC',
	"background_check_status" text DEFAULT 'PENDING',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "positive_earnings" CHECK ("driver_profiles"."total_earnings" >= 0)
);
--> statement-breakpoint
CREATE TABLE "driver_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_url" text NOT NULL,
	"status" "verification_status" DEFAULT 'PENDING',
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"url" text,
	"user_agent" text,
	"user_id" integer,
	"severity" text DEFAULT 'MEDIUM',
	"source" text DEFAULT 'backend',
	"timestamp" timestamp DEFAULT now(),
	"metadata" jsonb DEFAULT '{}',
	"deleted_at" timestamp
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
	"created_at" timestamp DEFAULT now(),
	"released_at" timestamp,
	"cancelled_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "positive_amount" CHECK ("escrows"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fraud_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"transaction_id" integer,
	"order_id" integer,
	"reason" text NOT NULL,
	"severity" text DEFAULT 'MEDIUM',
	"status" text DEFAULT 'PENDING',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fuel_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"driver_id" integer,
	"station_id" text NOT NULL,
	"fuel_type" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_latitude" numeric(10, 8),
	"delivery_longitude" numeric(11, 8),
	"status" "order_status" DEFAULT 'PENDING',
	"scheduled_delivery_time" text,
	"accepted_at" timestamp,
	"picked_up_at" timestamp,
	"delivered_at" timestamp,
	"estimated_delivery_time" text,
	"notes" text,
	"confirmation_deadline" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "positive_quantity" CHECK ("fuel_orders"."quantity" > 0),
	CONSTRAINT "positive_unit_price" CHECK ("fuel_orders"."unit_price" > 0),
	CONSTRAINT "positive_total_amount" CHECK ("fuel_orders"."total_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"document_image_url" text,
	"verification_status" "verification_status" DEFAULT 'PENDING',
	"submitted_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp,
	"reviewed_by" integer,
	"rejection_reason" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "jwt_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"token_type" text NOT NULL,
	"session_id" text NOT NULL,
	"device_info" jsonb DEFAULT '{}',
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
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
	"rating" numeric(3, 2) DEFAULT '0.00',
	"total_orders" integer DEFAULT 0,
	"revenue" numeric(15, 2) DEFAULT '0.00',
	"verification_status" "verification_status" DEFAULT 'PENDING',
	"kyc_data" jsonb DEFAULT '{}',
	"kyc_status" "kyc_status" DEFAULT 'PENDING',
	"kyc_submitted_at" timestamp,
	"kyc_approved_at" timestamp,
	"kyc_approved_by" integer,
	"verification_level" text DEFAULT 'BASIC',
	"background_check_status" text DEFAULT 'PENDING',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "merchant_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "positive_revenue" CHECK ("merchant_profiles"."revenue" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"order_id" integer,
	"support_ticket_id" integer,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}',
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
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "moderation_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"admin_id" integer NOT NULL,
	"response" text NOT NULL,
	"action" text NOT NULL,
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
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
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
CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"details" jsonb NOT NULL,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"merchant_id" integer,
	"seller_id" integer NOT NULL,
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
	"customer_id" integer,
	"order_id" integer,
	"driver_id" integer,
	"merchant_id" integer,
	"product_id" integer,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "valid_rating" CHECK ("ratings"."rating" >= 1 AND "ratings"."rating" <= 5)
);
--> statement-breakpoint
CREATE TABLE "security_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}',
	"ip_address" text,
	"user_agent" text,
	"severity" text DEFAULT 'INFO',
	"timestamp" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ticket_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'MEDIUM',
	"status" "support_status" DEFAULT 'OPEN',
	"assigned_to" integer,
	"attachments" jsonb DEFAULT '[]',
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "support_tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "suspicious_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"activity_type" text NOT NULL,
	"description" text NOT NULL,
	"risk_level" text DEFAULT 'MEDIUM',
	"risk_indicators" jsonb DEFAULT '{}',
	"timestamp" timestamp DEFAULT now(),
	"ip_address" text,
	"device_fingerprint" text,
	"severity" text DEFAULT 'MEDIUM',
	"status" text DEFAULT 'PENDING',
	"investigated_by" integer,
	"investigated_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "toll_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"operating_hours" jsonb DEFAULT '{}',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "positive_price" CHECK ("toll_gates"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"driver_id" integer,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"status" text,
	"timestamp" timestamp DEFAULT now(),
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
	"transaction_ref" text,
	"payment_gateway_ref" text,
	"paystack_transaction_id" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}',
	"initiated_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "transactions_transaction_ref_unique" UNIQUE("transaction_ref"),
	CONSTRAINT "positive_amount" CHECK ("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"device_name" text,
	"device_type" text,
	"browser_info" text,
	"last_used_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "trusted_devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"heading" numeric(5, 2),
	"speed" numeric(8, 2),
	"accuracy" numeric(8, 2),
	"timestamp" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"paystack_recipient_code" text,
	"bank_name" text,
	"account_number" text,
	"account_name" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_paystack_recipient_code_unique" UNIQUE("paystack_recipient_code")
);
--> statement-breakpoint
CREATE TABLE "verification_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"expiry_date" timestamp,
	"status" text DEFAULT 'PENDING',
	"validation_score" numeric(3, 2),
	"extracted_data" jsonb DEFAULT '{}',
	"rejection_reason" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"uploaded_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_flagged_by_users_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_payment_actions" ADD CONSTRAINT "admin_payment_actions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_payment_actions" ADD CONSTRAINT "admin_payment_actions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_support_agent_id_users_id_fk" FOREIGN KEY ("support_agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_confirmations" ADD CONSTRAINT "delivery_confirmations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD CONSTRAINT "delivery_feedback_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD CONSTRAINT "delivery_feedback_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_feedback" ADD CONSTRAINT "delivery_feedback_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_kyc_approved_by_users_id_fk" FOREIGN KEY ("kyc_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_verifications" ADD CONSTRAINT "driver_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_verifications" ADD CONSTRAINT "driver_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_orders" ADD CONSTRAINT "fuel_orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_orders" ADD CONSTRAINT "fuel_orders_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jwt_tokens" ADD CONSTRAINT "jwt_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_kyc_approved_by_users_id_fk" FOREIGN KEY ("kyc_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_support_ticket_id_support_tickets_id_fk" FOREIGN KEY ("support_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_tokens" ADD CONSTRAINT "mfa_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_responses" ADD CONSTRAINT "moderation_responses_report_id_content_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."content_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_responses" ADD CONSTRAINT "moderation_responses_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_merchant_id_users_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_logs" ADD CONSTRAINT "security_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspicious_activities" ADD CONSTRAINT "suspicious_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspicious_activities" ADD CONSTRAINT "suspicious_activities_investigated_by_users_id_fk" FOREIGN KEY ("investigated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking" ADD CONSTRAINT "tracking_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking" ADD CONSTRAINT "tracking_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_flags_user_id_idx" ON "account_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_flags_flagged_by_idx" ON "account_flags" USING btree ("flagged_by");--> statement-breakpoint
CREATE INDEX "admin_payment_actions_admin_id_idx" ON "admin_payment_actions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_payment_actions_transaction_id_idx" ON "admin_payment_actions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "admin_users_user_id_idx" ON "admin_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_idx" ON "audit_logs" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "categories_name_idx" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "compliance_documents_user_id_idx" ON "compliance_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "content_reports_reported_by_idx" ON "content_reports" USING btree ("reported_by");--> statement-breakpoint
CREATE INDEX "content_reports_content_type_idx" ON "content_reports" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "conversations_customer_id_idx" ON "conversations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "conversations_support_agent_id_idx" ON "conversations" USING btree ("support_agent_id");--> statement-breakpoint
CREATE INDEX "delivery_confirmations_order_id_idx" ON "delivery_confirmations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_feedback_order_id_idx" ON "delivery_feedback" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_feedback_customer_id_idx" ON "delivery_feedback" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "delivery_feedback_driver_id_idx" ON "delivery_feedback" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_profiles_user_id_idx" ON "driver_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "driver_verifications_user_id_idx" ON "driver_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "error_logs_user_id_idx" ON "error_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "error_logs_severity_idx" ON "error_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "escrows_order_id_idx" ON "escrows" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "escrows_payer_id_idx" ON "escrows" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "escrows_payee_id_idx" ON "escrows" USING btree ("payee_id");--> statement-breakpoint
CREATE INDEX "fraud_alerts_user_id_idx" ON "fraud_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fraud_alerts_transaction_id_idx" ON "fraud_alerts" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "fraud_alerts_order_id_idx" ON "fraud_alerts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fuel_orders_customer_id_idx" ON "fuel_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "fuel_orders_driver_id_idx" ON "fuel_orders" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "identity_verifications_user_id_idx" ON "identity_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jwt_tokens_user_id_idx" ON "jwt_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jwt_tokens_token_idx" ON "jwt_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "jwt_tokens_session_id_idx" ON "jwt_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "merchant_profiles_user_id_idx" ON "merchant_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_receiver_id_idx" ON "messages" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "messages_order_id_idx" ON "messages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "messages_support_ticket_id_idx" ON "messages" USING btree ("support_ticket_id");--> statement-breakpoint
CREATE INDEX "mfa_tokens_user_id_idx" ON "mfa_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mfa_tokens_token_idx" ON "mfa_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "moderation_responses_report_id_idx" ON "moderation_responses" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "moderation_responses_admin_id_idx" ON "moderation_responses" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_merchant_id_idx" ON "orders" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "orders_driver_id_idx" ON "orders" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "payment_methods_user_id_idx" ON "payment_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "products_merchant_id_idx" ON "products" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "products_seller_id_idx" ON "products" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ratings_customer_id_idx" ON "ratings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ratings_order_id_idx" ON "ratings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ratings_driver_id_idx" ON "ratings" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "ratings_merchant_id_idx" ON "ratings" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "ratings_product_id_idx" ON "ratings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "security_logs_user_id_idx" ON "security_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_logs_event_type_idx" ON "security_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_ticket_number_idx" ON "support_tickets" USING btree ("ticket_number");--> statement-breakpoint
CREATE INDEX "suspicious_activities_user_id_idx" ON "suspicious_activities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "suspicious_activities_activity_type_idx" ON "suspicious_activities" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "toll_gates_name_idx" ON "toll_gates" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tracking_order_id_idx" ON "tracking" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "tracking_driver_id_idx" ON "tracking" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_order_id_idx" ON "transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "transactions_ref_idx" ON "transactions" USING btree ("transaction_ref");--> statement-breakpoint
CREATE INDEX "transactions_paystack_idx" ON "transactions" USING btree ("paystack_transaction_id");--> statement-breakpoint
CREATE INDEX "trusted_devices_user_id_idx" ON "trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trusted_devices_device_id_idx" ON "trusted_devices" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "user_locations_user_id_idx" ON "user_locations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_paystack_recipient_idx" ON "users" USING btree ("paystack_recipient_code");--> statement-breakpoint
CREATE INDEX "verification_documents_user_id_idx" ON "verification_documents" USING btree ("user_id");