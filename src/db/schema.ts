
import { 
  pgTable, serial, text, integer, timestamp, jsonb, boolean, decimal, pgEnum, varchar, numeric, index, check
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { z } from 'zod';

// ---------------- Enums ----------------
export const roleEnum = pgEnum('role', ['CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN']);
export const verificationStatusEnum = pgEnum('verification_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const orderStatusEnum = pgEnum('order_status', ['PENDING', 'CONFIRMED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']);
export const transactionTypeEnum = pgEnum('transaction_type', ['PAYMENT', 'DELIVERY_EARNINGS', 'REFUND', 'ESCROW_RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT']);
export const kycStatusEnum = pgEnum('kyc_status', ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION']);
export const driverTierEnum = pgEnum('driver_tier', ['STANDARD', 'PREMIUM', 'ELITE']);
export const supportStatusEnum = pgEnum('support_status', ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export const escrowStatusEnum = pgEnum('escrow_status', ['HELD', 'RELEASED', 'REFUNDED', 'DISPUTED']);

// ---------------- Users ----------------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
  password: text("password"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  profilePicture: text("profile_picture"),
  role: roleEnum("role").default('CONSUMER'),
  isVerified: boolean("is_verified").default(false),
  isActive: boolean("is_active").default(true),
  mfaEnabled: boolean("mfa_enabled").default(false),
  mfaMethod: text("mfa_method"),
  mfaSecret: text("mfa_secret"),
  mfaBackupCodes: jsonb("mfa_backup_codes").default('[]'),
  biometricHash: text("biometric_hash"),
  biometricType: text("biometric_type"),
  lastLoginAt: timestamp("last_login_at"),
  loginAttempts: integer("login_attempts").default(0),
  accountLockedUntil: timestamp("account_locked_until"),
  averageRating: numeric("average_rating", { precision: 3, scale: 2 }).default('0.00'),
  totalRatings: integer("total_ratings").default(0),
  paystackRecipientCode: text("paystack_recipient_code").unique(),
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  accountName: text("account_name"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  emailIdx: index("users_email_idx").on(table.email),
  roleIdx: index("users_role_idx").on(table.role),
  paystackRecipientCodeIdx: index("users_paystack_recipient_idx").on(table.paystackRecipientCode)
}));

// ---------------- Categories ----------------
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  nameIdx: index("categories_name_idx").on(table.name)
}));

// ---------------- Products ----------------
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").references(() => users.id),
  sellerId: integer("seller_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 15, scale: 2 }).notNull(),
  categoryId: integer("category_id").references(() => categories.id),
  unit: text("unit"),
  stockQuantity: integer("stock_quantity").default(0),
  stockLevel: integer("stock_level").default(0),
  imageUrl: text("image_url"),
  images: jsonb("images").default('[]'),
  isAvailable: boolean("is_available").default(true),
  isActive: boolean("is_active").default(true),
  rating: decimal("rating", { precision: 3, scale: 2 }).default('0.00'),
  totalReviews: integer("total_reviews").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  merchantIdIdx: index("products_merchant_id_idx").on(table.merchantId),
  sellerIdIdx: index("products_seller_id_idx").on(table.sellerId),
  categoryIdIdx: index("products_category_id_idx").on(table.categoryId),
  positivePrice: check("positive_price", sql`${table.price} > 0`)
}));

// ---------------- Orders ----------------
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").unique().notNull(),
  customerId: integer("customer_id").references(() => users.id).notNull(),
  merchantId: integer("merchant_id").references(() => users.id),
  driverId: integer("driver_id").references(() => users.id),
  orderType: text("order_type").notNull(),
  status: orderStatusEnum("status").default('PENDING'),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  driverEarnings: decimal("driver_earnings", { precision: 15, scale: 2 }),
  deliveryAddress: text("delivery_address"),
  pickupAddress: text("pickup_address"),
  deliveryLatitude: decimal("delivery_latitude", { precision: 10, scale: 8 }),
  deliveryLongitude: decimal("delivery_longitude", { precision: 11, scale: 8 }),
  orderData: jsonb("order_data").default('{}'),
  acceptedAt: timestamp("accepted_at"),
  pickedUpAt: timestamp("picked_up_at"),
  deliveredAt: timestamp("delivered_at"),
  confirmationDeadline: timestamp("confirmation_deadline"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  customerIdIdx: index("orders_customer_id_idx").on(table.customerId),
  merchantIdIdx: index("orders_merchant_id_idx").on(table.merchantId),
  driverIdIdx: index("orders_driver_id_idx").on(table.driverId),
  orderNumberIdx: index("orders_order_number_idx").on(table.orderNumber),
  positiveTotalAmount: check("positive_total_amount", sql`${table.totalAmount} > 0`)
}));

// ---------------- Escrows ----------------
export const escrows = pgTable("escrows", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  payerId: integer("payer_id").notNull().references(() => users.id),
  payeeId: integer("payee_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  status: escrowStatusEnum("status").default("HELD"),
  paystackEscrowId: text("paystack_escrow_id"),
  transactionRef: text("transaction_ref"),
  createdAt: timestamp("created_at").defaultNow(),
  releasedAt: timestamp("released_at"),
  cancelledAt: timestamp("cancelled_at"),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  orderIdIdx: index("escrows_order_id_idx").on(table.orderId),
  payerIdIdx: index("escrows_payer_id_idx").on(table.payerId),
  payeeIdIdx: index("escrows_payee_id_idx").on(table.payeeId),
  positiveAmount: check("positive_amount", sql`${table.amount} > 0`)
}));

// ---------------- Transactions ----------------
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  orderId: integer("order_id").references(() => orders.id),
  recipientId: integer("recipient_id").references(() => users.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  netAmount: decimal("net_amount", { precision: 15, scale: 2 }),
  currency: text("currency").default('NGN'),
  type: transactionTypeEnum("type").notNull(),
  status: paymentStatusEnum("status").default('PENDING'),
  paymentMethod: text("payment_method"),
  transactionRef: text("transaction_ref").unique(),
  paymentGatewayRef: text("payment_gateway_ref"),
  paystackTransactionId: text("paystack_transaction_id"),
  description: text("description"),
  metadata: jsonb("metadata").default('{}'),
  initiatedAt: timestamp("initiated_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("transactions_user_id_idx").on(table.userId),
  orderIdIdx: index("transactions_order_id_idx").on(table.orderId),
  transactionRefIdx: index("transactions_ref_idx").on(table.transactionRef),
  paystackTransactionIdIdx: index("transactions_paystack_idx").on(table.paystackTransactionId),
  positiveAmount: check("positive_amount", sql`${table.amount} > 0`)
}));

// ---------------- Driver Profiles ----------------
export const driverProfiles = pgTable("driver_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  vehicleType: varchar("vehicle_type", { length: 50 }),
  vehiclePlate: varchar("vehicle_plate", { length: 20 }),
  vehicleModel: varchar("vehicle_model", { length: 100 }),
  vehicleColor: text("vehicle_color"),
  licenseNumber: text("license_number"),
  vehicleRegistration: text("vehicle_registration"),
  currentLatitude: decimal("current_latitude", { precision: 10, scale: 8 }),
  currentLongitude: decimal("current_longitude", { precision: 11, scale: 8 }),
  isOnline: boolean("is_online").default(false),
  isAvailable: boolean("is_available").default(true),
  currentLocation: text("current_location"),
  rating: decimal("rating", { precision: 3, scale: 2 }).default('0.00'),
  totalRatings: integer("total_ratings").default(0),
  totalDeliveries: integer("total_deliveries").default(0),
  totalEarnings: decimal("total_earnings", { precision: 15, scale: 2 }).default('0.00'),
  averageDeliveryTime: integer("average_delivery_time"),
  verificationStatus: verificationStatusEnum("verification_status").default('PENDING'),
  tier: driverTierEnum("tier").default('STANDARD'),
  kycData: jsonb("kyc_data").default('{}'),
  kycStatus: kycStatusEnum("kyc_status").default('PENDING'),
  kycSubmittedAt: timestamp("kyc_submitted_at"),
  kycApprovedAt: timestamp("kyc_approved_at"),
  kycApprovedBy: integer("kyc_approved_by").references(() => users.id),
  verificationLevel: text("verification_level").default('BASIC'),
  backgroundCheckStatus: text("background_check_status").default('PENDING'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("driver_profiles_user_id_idx").on(table.userId),
  positiveEarnings: check("positive_earnings", sql`${table.totalEarnings} >= 0`)
}));

// ---------------- Merchant Profiles ----------------
export const merchantProfiles = pgTable("merchant_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  businessName: text("business_name").notNull(),
  businessAddress: text("business_address"),
  businessType: text("business_type"),
  businessPhone: text("business_phone"),
  businessEmail: text("business_email"),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  phone: text("phone"),
  description: text("description"),
  operatingHours: jsonb("operating_hours").default('{}'),
  isOpen: boolean("is_open").default(true),
  isVerified: boolean("is_verified").default(false),
  isActive: boolean("is_active").default(true),
  rating: decimal("rating", { precision: 3, scale: 2 }).default('0.00'),
  totalOrders: integer("total_orders").default(0),
  revenue: decimal("revenue", { precision: 15, scale: 2 }).default('0.00'),
  verificationStatus: verificationStatusEnum("verification_status").default('PENDING'),
  kycData: jsonb("kyc_data").default('{}'),
  kycStatus: kycStatusEnum("kyc_status").default('PENDING'),
  kycSubmittedAt: timestamp("kyc_submitted_at"),
  kycApprovedAt: timestamp("kyc_approved_at"),
  kycApprovedBy: integer("kyc_approved_by").references(() => users.id),
  verificationLevel: text("verification_level").default('BASIC'),
  backgroundCheckStatus: text("background_check_status").default('PENDING'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("merchant_profiles_user_id_idx").on(table.userId),
  positiveRevenue: check("positive_revenue", sql`${table.revenue} >= 0`)
}));

// ---------------- Fuel Orders ----------------
export const fuelOrders = pgTable("fuel_orders", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => users.id).notNull(),
  driverId: integer("driver_id").references(() => users.id),
  stationId: text("station_id").notNull(),
  fuelType: text("fuel_type").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  deliveryLatitude: decimal("delivery_latitude", { precision: 10, scale: 8 }),
  deliveryLongitude: decimal("delivery_longitude", { precision: 11, scale: 8 }),
  status: orderStatusEnum("status").default('PENDING'),
  scheduledDeliveryTime: text("scheduled_delivery_time"),
  acceptedAt: timestamp("accepted_at"),
  pickedUpAt: timestamp("picked_up_at"),
  deliveredAt: timestamp("delivered_at"),
  estimatedDeliveryTime: text("estimated_delivery_time"),
  notes: text("notes"),
  confirmationDeadline: timestamp("confirmation_deadline"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  customerIdIdx: index("fuel_orders_customer_id_idx").on(table.customerId),
  driverIdIdx: index("fuel_orders_driver_id_idx").on(table.driverId),
  positiveQuantity: check("positive_quantity", sql`${table.quantity} > 0`),
  positiveUnitPrice: check("positive_unit_price", sql`${table.unitPrice} > 0`),
  positiveTotalAmount: check("positive_total_amount", sql`${table.totalAmount} > 0`)
}));

// Add all other tables from your schema...
export const ratings = pgTable("ratings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => users.id),
  orderId: integer("order_id").references(() => orders.id),
  driverId: integer("driver_id").references(() => users.id),
  merchantId: integer("merchant_id").references(() => users.id),
  productId: integer("product_id").references(() => products.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  customerIdIdx: index("ratings_customer_id_idx").on(table.customerId),
  orderIdIdx: index("ratings_order_id_idx").on(table.orderId),
  driverIdIdx: index("ratings_driver_id_idx").on(table.driverId),
  merchantIdIdx: index("ratings_merchant_id_idx").on(table.merchantId),
  productIdIdx: index("ratings_product_id_idx").on(table.productId),
  validRating: check("valid_rating", sql`${table.rating} >= 1 AND ${table.rating} <= 5`)
}));

export const deliveryFeedback = pgTable("delivery_feedback", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  customerId: integer("customer_id").references(() => users.id).notNull(),
  driverId: integer("driver_id").references(() => users.id).notNull(),
  feedbackType: varchar("feedback_type", { length: 50 }).notNull(),
  driverRating: integer("driver_rating"),
  serviceRating: integer("service_rating"),
  deliveryTimeRating: integer("delivery_time_rating"),
  deliveryQuality: varchar("delivery_quality", { length: 20 }),
  wouldRecommend: boolean("would_recommend"),
  issuesReported: text("issues_reported"),
  customerRating: integer("customer_rating"),
  deliveryComplexity: varchar("delivery_complexity", { length: 20 }),
  customerCooperation: varchar("customer_cooperation", { length: 20 }),
  paymentIssues: boolean("payment_issues"),
  comment: text("comment"),
  additionalFeedback: text("additional_feedback"),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  orderIdIdx: index("delivery_feedback_order_id_idx").on(table.orderId),
  customerIdIdx: index("delivery_feedback_customer_id_idx").on(table.customerId),
  driverIdIdx: index("delivery_feedback_driver_id_idx").on(table.driverId),
  validDriverRating: check("valid_driver_rating", sql`${table.driverRating} IS NULL OR (${table.driverRating} >= 1 AND ${table.driverRating} <= 5)`),
  validServiceRating: check("valid_service_rating", sql`${table.serviceRating} IS NULL OR (${table.serviceRating} >= 1 AND ${table.serviceRating} <= 5)`),
  validDeliveryTimeRating: check("valid_delivery_time_rating", sql`${table.deliveryTimeRating} IS NULL OR (${table.deliveryTimeRating} >= 1 AND ${table.deliveryTimeRating} <= 5)`),
  validCustomerRating: check("valid_customer_rating", sql`${table.customerRating} IS NULL OR (${table.customerRating} >= 1 AND ${table.customerRating} <= 5)`)
}));

export const deliveryConfirmations = pgTable("delivery_confirmations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull().unique(),
  driverConfirmed: boolean("driver_confirmed").default(false),
  consumerConfirmed: boolean("consumer_confirmed").default(false),
  confirmationDeadline: timestamp("confirmation_deadline"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  orderIdIdx: index("delivery_confirmations_order_id_idx").on(table.orderId)
}));

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  ticketNumber: text("ticket_number").unique().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  priority: text("priority").default('MEDIUM'),
  status: supportStatusEnum("status").default('OPEN'),
  assignedTo: integer("assigned_to").references(() => users.id),
  attachments: jsonb("attachments").default('[]'),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("support_tickets_user_id_idx").on(table.userId),
  ticketNumberIdx: index("support_tickets_ticket_number_idx").on(table.ticketNumber)
}));

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  details: jsonb("details").default('{}'),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  userIdIdx: index("audit_logs_user_id_idx").on(table.userId),
  entityTypeIdx: index("audit_logs_entity_type_idx").on(table.entityType)
}));

export const tracking = pgTable("tracking", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  driverId: integer("driver_id").references(() => users.id),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  status: text("status"),
  timestamp: timestamp("timestamp").defaultNow(),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  orderIdIdx: index("tracking_order_id_idx").on(table.orderId),
  driverIdIdx: index("tracking_driver_id_idx").on(table.driverId)
}));

export const fraudAlerts = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  transactionId: integer("transaction_id").references(() => transactions.id),
  orderId: integer("order_id").references(() => orders.id),
  reason: text("reason").notNull(),
  severity: text("severity").default('MEDIUM'),
  status: text("status").default('PENDING'),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("fraud_alerts_user_id_idx").on(table.userId),
  transactionIdIdx: index("fraud_alerts_transaction_id_idx").on(table.transactionId),
  orderIdIdx: index("fraud_alerts_order_id_idx").on(table.orderId)
}));

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").references(() => users.id).notNull(),
  receiverId: integer("receiver_id").references(() => users.id).notNull(),
  orderId: integer("order_id").references(() => orders.id),
  supportTicketId: integer("support_ticket_id").references(() => supportTickets.id),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  senderIdIdx: index("messages_sender_id_idx").on(table.senderId),
  receiverIdIdx: index("messages_receiver_id_idx").on(table.receiverId),
  orderIdIdx: index("messages_order_id_idx").on(table.orderId),
  supportTicketIdIdx: index("messages_support_ticket_id_idx").on(table.supportTicketId)
}));

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull(),
  isRead: boolean("is_read").default(false),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("notifications_user_id_idx").on(table.userId)
}));

// Add remaining tables with similar structure...
// (The complete schema is quite large, so I'm showing the key tables here)

// Export all table types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// Validation schemas
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN']).default('CONSUMER')
});

export const insertProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  categoryId: z.number().int().positive(),
  sellerId: z.number().int().positive(),
  unit: z.string().optional(),
  stockQuantity: z.number().int().min(0).default(0)
});
