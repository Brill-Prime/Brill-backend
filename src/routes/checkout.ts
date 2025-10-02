
import express from 'express';
import { db } from '../db/config';
import { cartItems, products, orders, orderItems, transactions, users } from '../db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';
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

    // Get user's wallet balance
    const userWallet = await db
      .select()
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

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
        walletBalance: userWallet[0]?.walletBalance || '0.00',
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

    // Handle wallet payment if requested
    if (validatedData.useWalletBalance) {
      const userWallet = await db
        .select()
        .from(users)
        .where(eq(users.id, currentUser.id))
        .limit(1);

      const walletBalance = Number(userWallet[0]?.walletBalance || 0);
      if (walletBalance < totalAmount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient wallet balance'
        });
      }
    }

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
    
    for (const [merchantId, items] of Object.entries(merchantGroups) as [string, any[]]) {
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

    // Create transaction record
    await db.insert(transactions).values({
      userId: currentUser.id,
      amount: totalAmount.toFixed(2),
      type: 'PAYMENT',
      status: validatedData.paymentMethod === 'WALLET' ? 'COMPLETED' : 'PENDING',
      paymentMethod: validatedData.paymentMethod,
      description: `Order payment for ${orderNumber}`,
      metadata: {
        orderIds: createdOrders.map(o => o.id),
        orderNumber
      }
    });

    // Deduct from wallet if using wallet balance
    if (validatedData.useWalletBalance && validatedData.paymentMethod === 'WALLET') {
      await db
        .update(users)
        .set({
          walletBalance: db.raw(`wallet_balance - ${totalAmount}`),
          updatedAt: new Date()
        })
        .where(eq(users.id, currentUser.id));
    }

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
        status: validatedData.paymentMethod === 'WALLET' ? 'PAID' : 'PENDING_PAYMENT'
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
