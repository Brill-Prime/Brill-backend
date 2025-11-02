
import express, { Request, Response, NextFunction } from 'express';
import { db } from '../db/config';
import { cartItems, commodities, users } from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import { firebaseAuth, AuthRequest } from '../middleware/firebaseAuth';

const router = express.Router();

// Validation schemas
const addToCartSchema = z.object({
  commodityId: z.number().int().positive(),
  quantity: z.number().int().min(1).default(1)
});

const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1)
});

// GET /api/cart - Get user's cart (READ)
router.get('/', firebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.user.userId;
    if (!firebaseUid) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Get user's ID from users table using Firebase UID
    const userRecord = await db.query.users.findFirst({
      where: eq(users.firebaseUid, firebaseUid)
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const cart = await db
      .select({
        id: cartItems.id,
        commodityId: cartItems.commodityId,
        quantity: cartItems.quantity,
        commodity: {
          id: commodities.id,
          name: commodities.name,
          description: commodities.description,
          price: commodities.price,
          unit: commodities.unit,
          imageUrl: commodities.imageUrl,
          stockQuantity: commodities.stockQuantity,
          merchantId: commodities.merchantId,
          category: commodities.category
        },
        addedAt: cartItems.createdAt,
        updatedAt: cartItems.updatedAt
      })
      .from(cartItems)
      .innerJoin(commodities, eq(cartItems.commodityId, commodities.id))
      .where(and(
        eq(cartItems.userId, userRecord.id),
        isNull(cartItems.deletedAt),
        isNull(commodities.deletedAt),
        eq(commodities.isActive, true)
      ))
      .orderBy(desc(cartItems.createdAt));

    // Calculate totals and check availability
    let subtotal = 0;
    let unavailableItems = 0;
    const items = cart.map(item => {
      const itemTotal = Number(item.commodity.price) * item.quantity;
      subtotal += itemTotal;

      const isAvailable = item.commodity.stockQuantity >= item.quantity;
      if (!isAvailable) unavailableItems++;

      return {
        ...item,
        itemTotal: itemTotal.toFixed(2),
        isAvailable,
        stockStatus: item.commodity.stockQuantity < item.quantity
          ? 'insufficient_stock'
          : 'in_stock'
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
          estimatedTotal: subtotal.toFixed(2),
          unavailableItems,
          canCheckout: unavailableItems === 0 && items.length > 0
        }
      }
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cart',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// GET /api/cart/:id - Get single cart item (READ)
router.get('/:id', firebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.user?.userId;
    if (!firebaseUid) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.firebaseUid, firebaseUid)
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const cartItemId = parseInt(req.params.id);
    if (isNaN(cartItemId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid cart item ID'
      });
    }

    const [cartItem] = await db
      .select({
        id: cartItems.id,
        commodityId: cartItems.commodityId,
        quantity: cartItems.quantity,
        commodity: {
          id: commodities.id,
          name: commodities.name,
          description: commodities.description,
          price: commodities.price,
          unit: commodities.unit,
          imageUrl: commodities.imageUrl,
          stockQuantity: commodities.stockQuantity,
          merchantId: commodities.merchantId
        },
        addedAt: cartItems.createdAt,
        updatedAt: cartItems.updatedAt
      })
      .from(cartItems)
      .innerJoin(commodities, eq(cartItems.commodityId, commodities.id))
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, userRecord.id),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    const itemTotal = Number(cartItem.commodity.price) * cartItem.quantity;
    const isAvailable = cartItem.commodity.stockQuantity >= cartItem.quantity;

    res.json({
      success: true,
      data: {
        ...cartItem,
        itemTotal: itemTotal.toFixed(2),
        isAvailable,
        stockStatus: cartItem.commodity.stockQuantity < cartItem.quantity
          ? 'insufficient_stock'
          : 'in_stock'
      }
    });
  } catch (error) {
    console.error('Get cart item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cart item',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// POST /api/cart - Add item to cart (CREATE)
router.post('/', firebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.user?.userId;
    if (!firebaseUid) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.firebaseUid, firebaseUid)
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const validatedData = addToCartSchema.parse(req.body);

    // Check if commodity exists and is available
    const [commodity] = await db
      .select()
      .from(commodities)
      .where(and(
        eq(commodities.id, validatedData.commodityId),
        isNull(commodities.deletedAt),
        eq(commodities.isActive, true)
      ))
      .limit(1);

    if (!commodity) {
      return res.status(404).json({
        success: false,
        message: 'Commodity not found or has been removed'
      });
    }

    // Check stock availability
    if (commodity.stockQuantity < validatedData.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${commodity.stockQuantity} units available in stock`,
        availableStock: commodity.stockQuantity
      });
    }

    // Check if item already exists in cart
    const [existingCartItem] = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.userId, userRecord.id),
        eq(cartItems.commodityId, validatedData.commodityId),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    let cartItem;
    let isUpdate = false;

    if (existingCartItem) {
      // Update quantity
      const newQuantity = existingCartItem.quantity + validatedData.quantity;

      if (commodity.stockQuantity < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `Cannot add ${validatedData.quantity} more. Only ${commodity.stockQuantity} units available (${existingCartItem.quantity} already in cart)`,
          availableStock: commodity.stockQuantity,
          currentQuantity: existingCartItem.quantity
        });
      }

      [cartItem] = await db
        .update(cartItems)
        .set({
          quantity: newQuantity,
          updatedAt: new Date()
        })
        .where(eq(cartItems.id, existingCartItem.id))
        .returning();

      isUpdate = true;
    } else {
      // Add new item
      [cartItem] = await db
        .insert(cartItems)
        .values({
          userId: userRecord.id,
          commodityId: validatedData.commodityId,
          quantity: validatedData.quantity
        })
        .returning();
    }

    res.status(201).json({
      success: true,
      message: isUpdate ? 'Cart quantity updated' : 'Item added to cart',
      data: {
        ...cartItem,
        commodity: {
          id: commodity.id,
          name: commodity.name,
          price: commodity.price,
          imageUrl: commodity.imageUrl
        },
        itemTotal: (Number(commodity.price) * cartItem.quantity).toFixed(2)
      }
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
      message: 'Failed to add item to cart',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// PUT /api/cart/:id - Update cart item quantity (UPDATE)
router.put('/:id', firebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.user?.userId;
    if (!firebaseUid) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.firebaseUid, firebaseUid)
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const cartItemId = parseInt(req.params.id);
    const validatedData = updateCartItemSchema.parse(req.body);

    if (isNaN(cartItemId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid cart item ID'
      });
    }

    // Check if cart item exists and belongs to user
    const [existingItem] = await db
      .select({
        cartItem: cartItems,
        commodity: commodities
      })
      .from(cartItems)
      .innerJoin(commodities, eq(cartItems.commodityId, commodities.id))
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, userRecord.id),
        isNull(cartItems.deletedAt),
        isNull(commodities.deletedAt)
      ))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    // Check stock availability
    if (existingItem.commodity.stockQuantity < validatedData.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${existingItem.commodity.stockQuantity} units available`,
        availableStock: existingItem.commodity.stockQuantity
      });
    }

    const [updatedItem] = await db
      .update(cartItems)
      .set({
        quantity: validatedData.quantity,
        updatedAt: new Date()
      })
      .where(eq(cartItems.id, cartItemId))
      .returning();

    const itemTotal = Number(existingItem.commodity.price) * validatedData.quantity;

    res.json({
      success: true,
      message: 'Cart item updated successfully',
      data: {
        ...updatedItem,
        commodity: {
          id: existingItem.commodity.id,
          name: existingItem.commodity.name,
          price: existingItem.commodity.price,
          imageUrl: existingItem.commodity.imageUrl
        },
        itemTotal: itemTotal.toFixed(2)
      }
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
      message: 'Failed to update cart item',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// DELETE /api/cart/:id - Remove item from cart (DELETE)
router.delete('/:id', firebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.user.userId;
    if (!firebaseUid) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.firebaseUid, firebaseUid)
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const cartItemId = parseInt(req.params.id);

    if (isNaN(cartItemId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid cart item ID'
      });
    }

    // Check if cart item exists and belongs to user
    const [existingItem] = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, userRecord.id),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    // Soft delete the cart item
    await db
      .update(cartItems)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(cartItems.id, cartItemId));

    res.json({
      success: true,
      message: 'Item removed from cart successfully',
      data: {
        removedItemId: cartItemId
      }
    });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from cart',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// DELETE /api/cart - Clear entire cart (DELETE ALL)
router.delete('/', firebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.user.userId;
    if (!firebaseUid) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userRecord = await db.query.users.findFirst({
      where: eq(users.firebaseUid, firebaseUid)
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get count of items before clearing
    const itemsToDelete = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.userId, userRecord.id),
        isNull(cartItems.deletedAt)
      ));

    const itemCount = itemsToDelete.length;

    if (itemCount === 0) {
      return res.json({
        success: true,
        message: 'Cart is already empty',
        data: {
          itemsRemoved: 0
        }
      });
    }

    // Soft delete all cart items
    await db
      .update(cartItems)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(cartItems.userId, userRecord.id),
        isNull(cartItems.deletedAt)
      ));

    res.json({
      success: true,
      message: 'Cart cleared successfully',
      data: {
        itemsRemoved: itemCount
      }
    });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cart',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;
