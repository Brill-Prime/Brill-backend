
import { 
  pgTable, serial, text, integer, timestamp, jsonb, boolean, decimal, pgEnum, varchar, numeric, index, check, sql 
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
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

// Continue with remaining tables... (truncating for brevity, but include all tables from your schema)

// Export all table types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

// Validation schemas
export const insertUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN']).default('CONSUMER')
});
