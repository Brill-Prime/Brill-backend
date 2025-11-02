import {
  pgTable, serial, text, integer, timestamp, jsonb, boolean, decimal, pgEnum, varchar, numeric, index, check, uniqueIndex
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
export const invoiceStatusEnum = pgEnum('invoice_status', ['DUE', 'PAID', 'OVERDUE']);

// ---------------- Users ----------------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  firebaseUid: text("firebase_uid").unique(),
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  emailIdx: index("users_email_idx").on(table.email),
  firebaseUidIdx: index("users_firebase_uid_idx").on(table.firebaseUid),
  roleIdx: index("users_role_idx").on(table.role)
}));

// ---------------- Commodities ----------------
export const commodities = pgTable("commodities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  merchantId: integer("merchant_id").references(() => users.id).notNull(),
  category: text("category"),
  imageUrl: text("image_url"),
  stockQuantity: integer("stock_quantity").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  merchantIdx: index("commodities_merchant_idx").on(table.merchantId),
  categoryIdx: index("commodities_category_idx").on(table.category),
  nameIdx: uniqueIndex("commodities_name_unique_idx").on(table.name)
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
  commodityId: integer("commodity_id").references(() => commodities.id),
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

// ---------------- Cart Items ----------------
export const cartItems = pgTable("cart_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  commodityId: integer("commodity_id").notNull().references(() => commodities.id),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdx: index("cart_items_user_idx").on(table.userId),
  commodityIdx: index("cart_items_commodity_idx").on(table.commodityId),
  uniqueUserCommodity: uniqueIndex("cart_items_user_commodity_unique_idx").on(table.userId, table.commodityId)
}));

// ---------------- Orders ----------------
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: integer("customer_id").references(() => users.id).notNull(),
  merchantId: integer("merchant_id").references(() => users.id),
  driverId: integer("driver_id").references(() => users.id),
  orderType: text("order_type").notNull(),
  status: orderStatusEnum("status").default('PENDING'),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  driverEarnings: decimal("driver_earnings", { precision: 10, scale: 2 }),
  deliveryAddress: text("delivery_address").notNull(),
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

// ---------------- Invoices ----------------
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").default('DUE'),
  dueDate: timestamp("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  orderIdIdx: index("invoices_order_id_idx").on(table.orderId),
  invoiceNumberIdx: index("invoices_invoice_number_idx").on(table.invoiceNumber)
}));

// ---------------- Driver Profiles ----------------
export const driverProfiles = pgTable("driver_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  vehicleDetails: jsonb("vehicle_details"),
  vehicleType: text("vehicle_type"),
  vehiclePlate: text("vehicle_plate"),
  vehicleModel: text("vehicle_model"),
  vehicleColor: text("vehicle_color"),
  licenseNumber: text("license_number"),
  vehicleRegistration: text("vehicle_registration"),
  drivingLicense: text("driving_license"),
  currentLocation: jsonb("current_location"),
  verificationLevel: text("verification_level"),
  backgroundCheckStatus: text("background_check_status"),
  kycData: jsonb("kyc_data").default('{}'),
  tier: driverTierEnum("tier").default('STANDARD'),
  availability: boolean("availability").default(true),
  isAvailable: boolean("is_available").default(true),
  isOnline: boolean("is_online").default(false),
  verificationStatus: verificationStatusEnum("verification_status").default('PENDING'),
  kycStatus: kycStatusEnum("kyc_status").default('PENDING'),
  kycApprovedAt: timestamp("kyc_approved_at"),
  kycApprovedBy: integer("kyc_approved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

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
  verificationLevel: text("verification_level").default('BASIC'),
  backgroundCheckStatus: text("background_check_status").default('PENDING'),
  verificationStatus: verificationStatusEnum("verification_status").default('PENDING'),
  kycStatus: kycStatusEnum("kyc_status").default('PENDING'),
  kycData: jsonb("kyc_data").default('{}'),
  kycApprovedAt: timestamp("kyc_approved_at"),
  kycApprovedBy: integer("kyc_approved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("merchant_profiles_user_id_idx").on(table.userId)
}));

// ---------------- Ratings ----------------
export const ratings = pgTable("ratings", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  raterId: integer("rater_id").references(() => users.id).notNull(),
  ratedId: integer("rated_id").references(() => users.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow()
});

// ---------------- MFA Tokens ----------------
export const mfaTokens = pgTable("mfa_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  token: text("token").notNull(),
  method: text("method").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").default(false),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  userIdIdx: index("mfa_tokens_user_id_idx").on(table.userId)
}));

// ---------------- Audit Logs ----------------
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  details: jsonb("details").default('{}'),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  userIdIdx: index("audit_logs_user_id_idx").on(table.userId),
  entityTypeIdx: index("audit_logs_entity_type_idx").on(table.entityType),
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt)
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
  paymentGatewayRef: text("payment_gateway_ref"),
  paystackTransactionId: text("paystack_transaction_id"),
  transactionRef: text("transaction_ref").notNull().unique(),
  description: text("description"),
  metadata: jsonb("metadata").default('{}'),
  initiatedAt: timestamp("initiated_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("transactions_user_id_idx").on(table.userId),
  orderIdIdx: index("transactions_order_id_idx").on(table.orderId),
  transactionRefIdx: index("transactions_ref_idx").on(table.transactionRef)
}));

// ---------------- Escrows ----------------
export const escrows = pgTable("escrows", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  payerId: integer("payer_id").references(() => users.id).notNull(),
  payeeId: integer("payee_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  status: escrowStatusEnum("status").default('HELD'),
  paystackEscrowId: text("paystack_escrow_id"),
  transactionRef: text("transaction_ref"),
  releaseDate: timestamp("release_date"),
  releasedAt: timestamp("released_at"),
  disputeReason: text("dispute_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  orderIdIdx: index("escrows_order_id_idx").on(table.orderId)
}));

// ---------------- Notifications ----------------
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

// ---------------- Order Items ----------------
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  productId: integer("product_id").references(() => products.id),
  quantity: integer("quantity").notNull(),
  price: decimal("price", { precision: 15, scale: 2 }).notNull(),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  orderIdIdx: index("order_items_order_id_idx").on(table.orderId)
}));

// ---------------- Messages ----------------
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").references(() => users.id).notNull(),
  receiverId: integer("receiver_id").references(() => users.id).notNull(),
  orderId: integer("order_id").references(() => orders.id),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  senderIdIdx: index("messages_sender_id_idx").on(table.senderId),
  receiverIdIdx: index("messages_receiver_id_idx").on(table.receiverId)
}));

// ---------------- Toll Gates ----------------
export const tollGates = pgTable("toll_gates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  fee: decimal("fee", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Support Tickets ----------------
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  orderId: integer("order_id").references(() => orders.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: supportStatusEnum("status").default('OPEN'),
  priority: text("priority").default('MEDIUM'),
  category: text("category"),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("support_tickets_user_id_idx").on(table.userId)
}));

// ---------------- Verification Documents ----------------
export const verificationDocuments = pgTable("verification_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  documentType: text("document_type").notNull(),
  documentNumber: text("document_number"),
  documentUrl: text("document_url").notNull(),
  status: verificationStatusEnum("status").default('PENDING'),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("verification_documents_user_id_idx").on(table.userId)
}));

// ---------------- Content Reports ----------------
export const contentReports = pgTable("content_reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").references(() => users.id).notNull(),
  reportedUserId: integer("reported_user_id").references(() => users.id),
  reportedItemId: integer("reported_item_id"),
  reportedItemType: text("reported_item_type"),
  reason: text("reason").notNull(),
  description: text("description"),
  status: text("status").default('PENDING'),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Fraud Alerts ----------------
export const fraudAlerts = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  transactionId: integer("transaction_id").references(() => transactions.id),
  alertType: text("alert_type").notNull(),
  riskLevel: text("risk_level").notNull(),
  description: text("description"),
  status: text("status").default('ACTIVE'),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Security Logs ----------------
export const securityLogs = pgTable("security_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  success: boolean("success").default(true),
  details: jsonb("details").default('{}'),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  userIdIdx: index("security_logs_user_id_idx").on(table.userId),
  createdAtIdx: index("security_logs_created_at_idx").on(table.createdAt)
}));

// ---------------- Error Logs ----------------
export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  errorType: text("error_type").notNull(),
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  requestUrl: text("request_url"),
  requestMethod: text("request_method"),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow()
});

// ---------------- Trusted Devices ----------------
export const trustedDevices = pgTable("trusted_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  deviceType: text("device_type"),
  isActive: boolean("is_active").default(true),
  lastUsed: timestamp("last_used").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
}, (table) => ({
  userIdIdx: index("trusted_devices_user_id_idx").on(table.userId)
}));

// ---------------- Suspicious Activities ----------------
export const suspiciousActivities = pgTable("suspicious_activities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  activityType: text("activity_type").notNull(),
  description: text("description"),
  riskScore: integer("risk_score"),
  ipAddress: text("ip_address"),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow()
});

// ---------------- Identity Verifications ----------------
export const identityVerifications = pgTable("identity_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  verificationType: text("verification_type").notNull(),
  data: jsonb("data").default('{}'),
  status: verificationStatusEnum("status").default('PENDING'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Fuel Orders ----------------
export const fuelOrders = pgTable("fuel_orders", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => users.id).notNull(),
  driverId: integer("driver_id").references(() => users.id),
  stationId: integer("station_id").references(() => users.id),
  fuelType: text("fuel_type").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  deliveryLatitude: decimal("delivery_latitude", { precision: 10, scale: 8 }),
  deliveryLongitude: decimal("delivery_longitude", { precision: 11, scale: 8 }),
  scheduledDeliveryTime: timestamp("scheduled_delivery_time"),
  estimatedDeliveryTime: timestamp("estimated_delivery_time"),
  notes: text("notes"),
  status: orderStatusEnum("status").default('PENDING'),
  acceptedAt: timestamp("accepted_at"),
  pickedUpAt: timestamp("picked_up_at"),
  deliveredAt: timestamp("delivered_at"),
  confirmationDeadline: timestamp("confirmation_deadline"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Moderation Responses ----------------
export const moderationResponses = pgTable("moderation_responses", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => contentReports.id).notNull(),
  adminId: integer("admin_id"),
  action: text("action").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Delivery Feedback ----------------
export const deliveryFeedback = pgTable("delivery_feedback", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  feedbackType: text("feedback_type"),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});

// ---------------- Tracking ----------------
export const tracking = pgTable("tracking", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  driverId: integer("driver_id").references(() => users.id),
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  orderIdIdx: index("tracking_order_id_idx").on(table.orderId)
}));

// ---------------- Admin Users ----------------
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  permissions: jsonb("permissions").default('[]'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at")
});


// ---------------- Relations ----------------
export const usersRelations = relations(users, ({ many, one }) => ({
  ordersAsCustomer: many(orders, { relationName: "customer" }),
  ordersAsMerchant: many(orders, { relationName: "merchant" }),
  ordersAsDriver: many(orders, { relationName: "driver" }),
  driverProfile: one(driverProfiles, {
    fields: [users.id],
    references: [driverProfiles.userId]
  }),
  merchantProfile: one(merchantProfiles, {
    fields: [users.id],
    references: [merchantProfiles.userId]
  }),
  commodities: many(commodities),
  ratingsGiven: many(ratings, { relationName: "rater" }),
  ratingsReceived: many(ratings, { relationName: "rated" })
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products)
}));

export const commoditiesRelations = relations(commodities, ({ many }) => ({
  products: many(products)
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  merchant: one(users, {
    fields: [products.merchantId],
    references: [users.id]
  }),
  seller: one(users, {
    fields: [products.sellerId],
    references: [users.id]
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id]
  }),
  commodity: one(commodities, {
    fields: [products.commodityId],
    references: [commodities.id]
  }),
  ratings: many(ratings)
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(users, {
    fields: [orders.customerId],
    references: [users.id],
    relationName: "customer"
  }),
  merchant: one(users, {
    fields: [orders.merchantId],
    references: [users.id],
    relationName: "merchant"
  }),
  driver: one(users, {
    fields: [orders.driverId],
    references: [users.id],
    relationName: "driver"
  }),
  invoices: many(invoices),
  ratings: many(ratings)
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id]
  })
}));

export const ratingsRelations = relations(ratings, ({ one }) => ({
  rater: one(users, { fields: [ratings.raterId], references: [users.id], relationName: "rater" }),
  rated: one(users, { fields: [ratings.ratedId], references: [users.id], relationName: "rated" }),
  order: one(orders, { fields: [ratings.orderId], references: [orders.id] })
}));


// ---------------- Validation Schemas ----------------
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN']).default('CONSUMER')
});

export const insertCommoditySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  unit: z.string().optional(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Commodity = typeof commodities.$inferSelect;
export type NewCommodity = typeof commodities.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;