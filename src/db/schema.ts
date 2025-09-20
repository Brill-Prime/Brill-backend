

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

// ---------------- Order Items ----------------
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  orderIdIdx: index("order_items_order_id_idx").on(table.orderId),
  productIdIdx: index("order_items_product_id_idx").on(table.productId),
  positiveQuantity: check("positive_quantity", sql`${table.quantity} > 0`),
  positiveUnitPrice: check("positive_unit_price", sql`${table.unitPrice} > 0`)
}));

// ---------------- Payments ----------------
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: text("currency").default('NGN'),
  status: paymentStatusEnum("status").default('PENDING'),
  paymentMethod: text("payment_method"),
  paystackReference: text("paystack_reference").unique(),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  orderIdIdx: index("payments_order_id_idx").on(table.orderId),
  userIdIdx: index("payments_user_id_idx").on(table.userId),
  paystackReferenceIdx: index("payments_paystack_reference_idx").on(table.paystackReference),
  positiveAmount: check("positive_amount", sql`${table.amount} > 0`)
}));

// ---------------- Transactions ----------------
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  type: transactionTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: text("currency").default('NGN'),
  description: text("description"),
  reference: text("reference").unique(),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  userIdIdx: index("transactions_user_id_idx").on(table.userId),
  typeIdx: index("transactions_type_idx").on(table.type),
  referenceIdx: index("transactions_reference_idx").on(table.reference)
}));

// ---------------- Escrow ----------------
export const escrow = pgTable("escrow", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).unique().notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  status: escrowStatusEnum("status").default('HELD'),
  createdAt: timestamp("created_at").defaultNow(),
  releasedAt: timestamp("released_at"),
  refundedAt: timestamp("refunded_at")
}, (table) => ({
  orderIdIdx: index("escrow_order_id_idx").on(table.orderId),
  statusIdx: index("escrow_status_idx").on(table.status)
}));

// ---------------- Driver Verification ----------------
export const driverVerification = pgTable("driver_verification", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").references(() => users.id).unique().notNull(),
  licenseNumber: text("license_number").notNull(),
  licenseExpiryDate: timestamp("license_expiry_date").notNull(),
  vehicleRegistration: text("vehicle_registration").notNull(),
  vehicleInsurance: text("vehicle_insurance").notNull(),
  status: verificationStatusEnum("status").default('PENDING'),
  rejectionReason: text("rejection_reason"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  driverIdIdx: index("driver_verification_driver_id_idx").on(table.driverId),
  statusIdx: index("driver_verification_status_idx").on(table.status)
}));

// ---------------- Driver Profiles ----------------
export const driverProfiles = pgTable("driver_profiles", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").references(() => users.id).unique().notNull(),
  vehicleType: text("vehicle_type"),
  vehicleModel: text("vehicle_model"),
  vehicleYear: integer("vehicle_year"),
  vehicleColor: text("vehicle_color"),
  plateNumber: text("plate_number").unique(),
  tier: driverTierEnum("tier").default('STANDARD'),
  isAvailable: boolean("is_available").default(true),
  currentLatitude: decimal("current_latitude", { precision: 10, scale: 8 }),
  currentLongitude: decimal("current_longitude", { precision: 11, scale: 8 }),
  lastLocationUpdate: timestamp("last_location_update"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
}, (table) => ({
  driverIdIdx: index("driver_profiles_driver_id_idx").on(table.driverId),
  plateNumberIdx: index("driver_profiles_plate_number_idx").on(table.plateNumber),
  tierIdx: index("driver_profiles_tier_idx").on(table.tier)
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
  createdAt: timestamp("created_at").defaultNow()
}, (table) => ({
  userIdIdx: index("notifications_user_id_idx").on(table.userId),
  typeIdx: index("notifications_type_idx").on(table.type),
  isReadIdx: index("notifications_is_read_idx").on(table.isRead)
}));

// ---------------- KYC Documents ----------------
export const kycDocuments = pgTable("kyc_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  documentType: text("document_type").notNull(),
  documentNumber: text("document_number"),
  documentUrl: text("document_url").notNull(),
  status: kycStatusEnum("status").default('PENDING'),
  rejectionReason: text("rejection_reason"),
  submittedAt: timestamp("submitted_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at")
}, (table) => ({
  userIdIdx: index("kyc_documents_user_id_idx").on(table.userId),
  statusIdx: index("kyc_documents_status_idx").on(table.status)
}));

// ---------------- Support Tickets ----------------
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: supportStatusEnum("status").default('OPEN'),
  priority: text("priority").default('MEDIUM'),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at")
}, (table) => ({
  userIdIdx: index("support_tickets_user_id_idx").on(table.userId),
  statusIdx: index("support_tickets_status_idx").on(table.status),
  assignedToIdx: index("support_tickets_assigned_to_idx").on(table.assignedTo)
}));

// Export all table types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
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

