
import express from 'express';
import { db } from '../db/config';
import { cartItems, products, orders, orderItems, transactions, users } from '../db/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const checkoutSchema = z.object({
  deliveryAddress: z.string().min(1),
  deliveryLatitude: z.string().optional(),
  deliveryLongitude: z.string().optional(),
  deliveryInstructions: z.string().optional(),
  paymentMethod: z.enum(['CARD', 'CASH', 'WALLET', 'BANK_TRANSFER']),
  useWalletBalance: z.boolean().default(false)
});

// Helper function to generate order number
const generateOrderNumber = (): string => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ORD${timestamp}${random}`;
};

// GET /api/checkout/preview - Preview checkout summary
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    // Get cart items with product details
    const cart = await db
      .select({
        id: cartItems.id,
        productId: cartItems.productId,
        quantity: cartItems.quantity,
        product: {
          id: products.id,
          name: products.name,
          price: products.price,
          unit: products.unit,
          merchantId: products.merchantId,
          stockQuantity: products.stockQuantity,
          isAvailable: products.isAvailable
        }
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt),
        isNull(products.deletedAt),
        eq(products.isActive, true),
        eq(products.isAvailable, true)
      ));

    if (!cart.length) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    // Check stock availability
    const unavailableItems = cart.filter(item => item.product.stockQuantity < item.quantity);
    if (unavailableItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some items are out of stock',
        unavailableItems: unavailableItems.map(item => ({
          productId: item.productId,
          name: item.product.name,
          requested: item.quantity,
          available: item.product.stockQuantity
        }))
      });
    }

    // Calculate totals
    let subtotal = 0;
    const items = cart.map(item => {
      const itemTotal = Number(item.product.price) * item.quantity;
      subtotal += itemTotal;
      return {
        productId: item.productId,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
        itemTotal: itemTotal.toFixed(2)
      };
    });

    const deliveryFee = 5.00; // Fixed delivery fee for now
    const serviceFee = subtotal * 0.05; // 5% service fee
    const total = subtotal + deliveryFee + serviceFee;

    res.json({
      success: true,
      data: {
        items,
        pricing: {
          subtotal: subtotal.toFixed(2),
          deliveryFee: deliveryFee.toFixed(2),
          serviceFee: serviceFee.toFixed(2),
          total: total.toFixed(2)
        },
        itemCount: items.length,
        totalQuantity: cart.reduce((sum, item) => sum + item.quantity, 0)
      }
    });
  } catch (error) {
    console.error('Checkout preview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate checkout preview'
    });
  }
});

// POST /api/checkout - Place order
router.post('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = checkoutSchema.parse(req.body);

    // Get cart items
    const cart = await db
      .select({
        id: cartItems.id,
        productId: cartItems.productId,
        quantity: cartItems.quantity,
        product: {
          id: products.id,
          name: products.name,
          price: products.price,
          merchantId: products.merchantId,
          stockQuantity: products.stockQuantity,
          isAvailable: products.isAvailable
        }
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt),
        isNull(products.deletedAt),
        eq(products.isActive, true),
        eq(products.isAvailable, true)
      ));

    if (!cart.length) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    // Verify stock availability
    const unavailableItems = cart.filter(item => item.product.stockQuantity < item.quantity);
    if (unavailableItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some items are out of stock',
        unavailableItems: unavailableItems.map(item => ({
          productId: item.productId,
          name: item.product.name,
          requested: item.quantity,
          available: item.product.stockQuantity
        }))
      });
    }

    // Calculate totals
    let subtotal = 0;
    cart.forEach(item => {
      subtotal += Number(item.product.price) * item.quantity;
    });

    const deliveryFee = 5.00;
    const serviceFee = subtotal * 0.05;
    const totalAmount = subtotal + deliveryFee + serviceFee;

    // Wallet payment removed - all payments go through Paystack

    // Generate unique order number
    let orderNumber: string;
    let isUnique = false;
    let attempts = 0;
    
    do {
      orderNumber = generateOrderNumber();
      const existingOrder = await db
        .select()
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      
      isUnique = existingOrder.length === 0;
      attempts++;
    } while (!isUnique && attempts < 10);

    // Group items by merchant
    const merchantGroups = cart.reduce((groups: any, item) => {
      const merchantId = item.product.merchantId;
      if (!groups[merchantId]) {
        groups[merchantId] = [];
      }
      groups[merchantId].push(item);
      return groups;
    }, {});

    // Create orders (one per merchant)
    const createdOrders = [];
    
    for (const [merchantId, items] of Object.entries(merchantGroups) as Array<[string, any[]]>) {
      const merchantSubtotal = items.reduce((sum, item) => 
        sum + (Number(item.product.price) * item.quantity), 0
      );
      
      const merchantTotal = merchantSubtotal + (deliveryFee / Object.keys(merchantGroups).length);

      const newOrder = await db.insert(orders).values({
        orderNumber: `${orderNumber}-${merchantId}`,
        customerId: currentUser.id,
        merchantId: parseInt(merchantId),
        orderType: 'PRODUCT_DELIVERY',
        totalAmount: merchantTotal.toFixed(2),
        deliveryAddress: validatedData.deliveryAddress,
        deliveryLatitude: validatedData.deliveryLatitude || null,
        deliveryLongitude: validatedData.deliveryLongitude || null,
        orderData: {
          deliveryInstructions: validatedData.deliveryInstructions,
          paymentMethod: validatedData.paymentMethod
        },
        status: 'PENDING',
        confirmationDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000)
      }).returning();

      // Create order items
      for (const item of items) {
        await db.insert(orderItems).values({
          orderId: newOrder[0].id,
          productId: item.productId,
          quantity: item.quantity,
          price: item.product.price,
          subtotal: (Number(item.product.price) * item.quantity).toFixed(2)
        });

        // Update product stock
        await db
          .update(products)
          .set({
            stockQuantity: item.product.stockQuantity - item.quantity,
            updatedAt: new Date()
          })
          .where(eq(products.id, item.productId));
      }

      createdOrders.push(newOrder[0]);
    }

    // Initialize Paystack payment
    const PaystackService = (await import('../services/paystack')).default;
    const paymentInit = await PaystackService.initializePayment(
      currentUser.email,
      totalAmount,
      `${orderNumber}_${Date.now()}`,
      {
        orderIds: createdOrders.map(o => o.id),
        orderNumber,
        customerId: currentUser.id
      }
    );

    // Create transaction record
    const [transaction] = await db.insert(transactions).values({
      userId: currentUser.id,
      amount: totalAmount.toFixed(2),
      type: 'PAYMENT',
      status: 'PENDING',
      paymentMethod: validatedData.paymentMethod,
      transactionRef: paymentInit.reference,
      paystackTransactionId: paymentInit.reference,
      description: `Order payment for ${orderNumber}`,
      metadata: {
        orderIds: createdOrders.map(o => o.id),
        orderNumber
      }
    }).returning();

    // Clear cart
    await db
      .update(cartItems)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt)
      ));

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: {
        orders: createdOrders,
        orderNumber,
        totalAmount: totalAmount.toFixed(2),
        paymentMethod: validatedData.paymentMethod,
        status: 'PENDING_PAYMENT',
        paymentUrl: paymentInit.authorization_url,
        paymentReference: paymentInit.reference
      }
    });
  } catch (error) {
    console.error('Checkout error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete checkout'
    });
  }
});

export default router;
