
import express from 'express';
import { db } from '../db/config';
import { cartItems, products, users } from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const addToCartSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).default(1)
});

const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1)
});

// GET /api/cart - Get user's cart
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    const cart = await db
      .select({
        id: cartItems.id,
        productId: cartItems.productId,
        quantity: cartItems.quantity,
        product: {
          id: products.id,
          name: products.name,
          description: products.description,
          price: products.price,
          unit: products.unit,
          imageUrl: products.imageUrl,
          isAvailable: products.isAvailable,
          stockQuantity: products.stockQuantity,
          merchantId: products.merchantId
        },
        addedAt: cartItems.createdAt
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt),
        isNull(products.deletedAt),
        eq(products.isActive, true)
      ))
      .orderBy(desc(cartItems.createdAt));

    // Calculate totals
    let subtotal = 0;
    const items = cart.map(item => {
      const itemTotal = Number(item.product.price) * item.quantity;
      subtotal += itemTotal;
      return {
        ...item,
        itemTotal: itemTotal.toFixed(2)
      };
    });

    res.json({
      success: true,
      data: {
        items,
        summary: {
          itemCount: items.length,
          totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
          subtotal: subtotal.toFixed(2),
          estimatedTotal: subtotal.toFixed(2)
        }
      }
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cart'
    });
  }
});

// POST /api/cart - Add item to cart
router.post('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = addToCartSchema.parse(req.body);

    // Check if product exists and is available
    const product = await db
      .select()
      .from(products)
      .where(and(
        eq(products.id, validatedData.productId),
        isNull(products.deletedAt),
        eq(products.isActive, true),
        eq(products.isAvailable, true)
      ))
      .limit(1);

    if (!product.length) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or unavailable'
      });
    }

    // Check stock availability
    if (product[0].stockQuantity < validatedData.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product[0].stockQuantity} units available in stock`
      });
    }

    // Check if item already exists in cart
    const existingCartItem = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.userId, currentUser.id),
        eq(cartItems.productId, validatedData.productId),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    let cartItem;

    if (existingCartItem.length) {
      // Update quantity
      const newQuantity = existingCartItem[0].quantity + validatedData.quantity;
      
      if (product[0].stockQuantity < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `Cannot add more. Only ${product[0].stockQuantity} units available`
        });
      }

      cartItem = await db
        .update(cartItems)
        .set({
          quantity: newQuantity,
          updatedAt: new Date()
        })
        .where(eq(cartItems.id, existingCartItem[0].id))
        .returning();
    } else {
      // Add new item
      cartItem = await db
        .insert(cartItems)
        .values({
          userId: currentUser.id,
          productId: validatedData.productId,
          quantity: validatedData.quantity
        })
        .returning();
    }

    res.status(201).json({
      success: true,
      message: 'Item added to cart',
      data: cartItem[0]
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to add item to cart'
    });
  }
});

// PUT /api/cart/:id - Update cart item quantity
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const cartItemId = parseInt(req.params.id);
    const validatedData = updateCartItemSchema.parse(req.body);

    if (isNaN(cartItemId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid cart item ID'
      });
    }

    // Check if cart item exists and belongs to user
    const existingItem = await db
      .select({
        cartItem: cartItems,
        product: products
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    if (!existingItem.length) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    // Check stock availability
    if (existingItem[0].product.stockQuantity < validatedData.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${existingItem[0].product.stockQuantity} units available`
      });
    }

    const updatedItem = await db
      .update(cartItems)
      .set({
        quantity: validatedData.quantity,
        updatedAt: new Date()
      })
      .where(eq(cartItems.id, cartItemId))
      .returning();

    res.json({
      success: true,
      message: 'Cart item updated',
      data: updatedItem[0]
    });
  } catch (error) {
    console.error('Update cart item error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update cart item'
    });
  }
});

// DELETE /api/cart/:id - Remove item from cart
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const cartItemId = parseInt(req.params.id);

    if (isNaN(cartItemId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid cart item ID'
      });
    }

    // Check if cart item exists and belongs to user
    const existingItem = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    if (!existingItem.length) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    await db
      .update(cartItems)
      .set({ deletedAt: new Date() })
      .where(eq(cartItems.id, cartItemId));

    res.json({
      success: true,
      message: 'Item removed from cart'
    });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart'
    });
  }
});

// DELETE /api/cart - Clear entire cart
router.delete('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    await db
      .update(cartItems)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt)
      ));

    res.json({
      success: true,
      message: 'Cart cleared successfully'
    });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart'
    });
  }
});

export default router;
