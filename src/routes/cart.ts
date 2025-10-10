
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

// GET /api/cart - Get user's cart (READ)
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
          merchantId: products.merchantId,
          categoryId: products.categoryId
        },
        addedAt: cartItems.createdAt,
        updatedAt: cartItems.updatedAt
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

    // Calculate totals and check availability
    let subtotal = 0;
    let unavailableItems = 0;
    const items = cart.map(item => {
      const itemTotal = Number(item.product.price) * item.quantity;
      subtotal += itemTotal;
      
      const isAvailable = item.product.isAvailable && item.product.stockQuantity >= item.quantity;
      if (!isAvailable) unavailableItems++;
      
      return {
        ...item,
        itemTotal: itemTotal.toFixed(2),
        isAvailable,
        stockStatus: item.product.stockQuantity < item.quantity 
          ? 'insufficient_stock' 
          : item.product.isAvailable 
          ? 'in_stock' 
          : 'out_of_stock'
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
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
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
        addedAt: cartItems.createdAt,
        updatedAt: cartItems.updatedAt
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    const itemTotal = Number(cartItem.product.price) * cartItem.quantity;
    const isAvailable = cartItem.product.isAvailable && cartItem.product.stockQuantity >= cartItem.quantity;

    res.json({
      success: true,
      data: {
        ...cartItem,
        itemTotal: itemTotal.toFixed(2),
        isAvailable,
        stockStatus: cartItem.product.stockQuantity < cartItem.quantity 
          ? 'insufficient_stock' 
          : cartItem.product.isAvailable 
          ? 'in_stock' 
          : 'out_of_stock'
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
router.post('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = addToCartSchema.parse(req.body);

    // Check if product exists and is available
    const [product] = await db
      .select()
      .from(products)
      .where(and(
        eq(products.id, validatedData.productId),
        isNull(products.deletedAt),
        eq(products.isActive, true)
      ))
      .limit(1);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or has been removed'
      });
    }

    if (!product.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Product is currently unavailable'
      });
    }

    // Check stock availability
    if (product.stockQuantity < validatedData.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stockQuantity} units available in stock`,
        availableStock: product.stockQuantity
      });
    }

    // Check if item already exists in cart
    const [existingCartItem] = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.userId, currentUser.id),
        eq(cartItems.productId, validatedData.productId),
        isNull(cartItems.deletedAt)
      ))
      .limit(1);

    let cartItem;
    let isUpdate = false;

    if (existingCartItem) {
      // Update quantity
      const newQuantity = existingCartItem.quantity + validatedData.quantity;
      
      if (product.stockQuantity < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `Cannot add ${validatedData.quantity} more. Only ${product.stockQuantity} units available (${existingCartItem.quantity} already in cart)`,
          availableStock: product.stockQuantity,
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
          userId: currentUser.id,
          productId: validatedData.productId,
          quantity: validatedData.quantity
        })
        .returning();
    }

    res.status(201).json({
      success: true,
      message: isUpdate ? 'Cart quantity updated' : 'Item added to cart',
      data: {
        ...cartItem,
        product: {
          id: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl
        },
        itemTotal: (Number(product.price) * cartItem.quantity).toFixed(2)
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
    const [existingItem] = await db
      .select({
        cartItem: cartItems,
        product: products
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, currentUser.id),
        isNull(cartItems.deletedAt),
        isNull(products.deletedAt)
      ))
      .limit(1);

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }

    // Check if product is still available
    if (!existingItem.product.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Product is no longer available'
      });
    }

    // Check stock availability
    if (existingItem.product.stockQuantity < validatedData.quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${existingItem.product.stockQuantity} units available`,
        availableStock: existingItem.product.stockQuantity
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

    const itemTotal = Number(existingItem.product.price) * validatedData.quantity;

    res.json({
      success: true,
      message: 'Cart item updated successfully',
      data: {
        ...updatedItem,
        product: {
          id: existingItem.product.id,
          name: existingItem.product.name,
          price: existingItem.product.price,
          imageUrl: existingItem.product.imageUrl
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
    const [existingItem] = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.id, cartItemId),
        eq(cartItems.userId, currentUser.id),
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
router.delete('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    // Get count of items before clearing
    const itemsToDelete = await db
      .select()
      .from(cartItems)
      .where(and(
        eq(cartItems.userId, currentUser.id),
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
        eq(cartItems.userId, currentUser.id),
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
