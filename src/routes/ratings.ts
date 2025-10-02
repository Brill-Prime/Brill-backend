
import express from 'express';
import { db } from '../db/config';
import { ratings, users, orders, products, auditLogs } from '../db/schema';
import { eq, desc, and, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createRatingSchema = z.object({
  orderId: z.number().int().positive().optional(),
  driverId: z.number().int().positive().optional(),
  merchantId: z.number().int().positive().optional(),
  productId: z.number().int().positive().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional()
});

const updateRatingSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().optional()
});

// Helper function to create audit log
const createAuditLog = async (userId: number, action: string, entityId: number, details: any) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'RATING',
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
};

// POST /api/ratings - Submit a new rating
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const validatedData = createRatingSchema.parse(req.body);

    // Validate that at least one target (driver, merchant, product) is provided
    if (!validatedData.driverId && !validatedData.merchantId && !validatedData.productId) {
      return res.status(400).json({
        success: false,
        message: 'At least one target (driverId, merchantId, or productId) must be provided'
      });
    }

    // If orderId is provided, verify it exists and belongs to the user
    if (validatedData.orderId) {
      const [order] = await db
        .select()
        .from(orders)
        .where(and(
          eq(orders.id, validatedData.orderId),
          eq(orders.customerId, userId),
          isNull(orders.deletedAt)
        ))
        .limit(1);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found or access denied'
        });
      }
    }

    // Verify target entities exist if provided
    if (validatedData.driverId) {
      const [driver] = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.driverId),
          eq(users.role, 'DRIVER'),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found'
        });
      }
    }

    if (validatedData.merchantId) {
      const [merchant] = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.merchantId),
          eq(users.role, 'MERCHANT'),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!merchant) {
        return res.status(404).json({
          success: false,
          message: 'Merchant not found'
        });
      }
    }

    if (validatedData.productId) {
      const [product] = await db
        .select()
        .from(products)
        .where(and(
          eq(products.id, validatedData.productId),
          isNull(products.deletedAt)
        ))
        .limit(1);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }
    }

    // Create the rating
    const [newRating] = await db
      .insert(ratings)
      .values({
        customerId: userId,
        orderId: validatedData.orderId,
        driverId: validatedData.driverId,
        merchantId: validatedData.merchantId,
        productId: validatedData.productId,
        rating: validatedData.rating,
        comment: validatedData.comment
      })
      .returning();

    // Create audit log
    await createAuditLog(userId, 'RATING_CREATED', newRating.id, {
      targetType: validatedData.driverId ? 'DRIVER' : 
                  validatedData.merchantId ? 'MERCHANT' : 
                  validatedData.productId ? 'PRODUCT' : 'UNKNOWN',
      rating: validatedData.rating
    });

    // Fetch the complete rating with related data
    const [completeRating] = await db
      .select({
        id: ratings.id,
        customerId: ratings.customerId,
        customerName: users.fullName,
        orderId: ratings.orderId,
        driverId: ratings.driverId,
        merchantId: ratings.merchantId,
        productId: ratings.productId,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(eq(ratings.id, newRating.id))
      .limit(1);

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      data: completeRating
    });

  } catch (error) {
    console.error('Create rating error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to submit rating'
    });
  }
});

// GET /api/ratings - List all ratings (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const allRatings = await db
      .select({
        id: ratings.id,
        customerId: ratings.customerId,
        customerName: users.fullName,
        orderId: ratings.orderId,
        driverId: ratings.driverId,
        merchantId: ratings.merchantId,
        productId: ratings.productId,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(isNull(ratings.deletedAt))
      .orderBy(desc(ratings.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: ratings.id })
      .from(ratings)
      .where(isNull(ratings.deletedAt));

    const totalCount = parseInt(count.toString());
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: allRatings,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      }
    });

  } catch (error) {
    console.error('Get ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ratings'
    });
  }
});

// GET /api/ratings/:id - Get rating details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const ratingId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (isNaN(ratingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rating ID'
      });
    }

    const [rating] = await db
      .select({
        id: ratings.id,
        customerId: ratings.customerId,
        customerName: users.fullName,
        orderId: ratings.orderId,
        driverId: ratings.driverId,
        merchantId: ratings.merchantId,
        productId: ratings.productId,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(and(
        eq(ratings.id, ratingId),
        isNull(ratings.deletedAt)
      ))
      .limit(1);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found'
      });
    }

    // Check if user has permission to view this rating
    const userRole = req.user?.role;
    const canView = userRole === 'ADMIN' || 
                   rating.customerId === userId ||
                   rating.driverId === userId ||
                   rating.merchantId === userId;

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: rating
    });

  } catch (error) {
    console.error('Get rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rating'
    });
  }
});

// GET /api/ratings/user/:id - List ratings by user
router.get('/user/:id', requireAuth, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const currentUserId = req.user?.id;
    const userRole = req.user?.role;

    if (isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check permissions - admin, the user themselves, or ratings about them
    const canView = userRole === 'ADMIN' || currentUserId === targetUserId;

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    // Get ratings by user (as customer) or about user (as driver/merchant)
    const userRatings = await db
      .select({
        id: ratings.id,
        customerId: ratings.customerId,
        customerName: users.fullName,
        orderId: ratings.orderId,
        driverId: ratings.driverId,
        merchantId: ratings.merchantId,
        productId: ratings.productId,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(and(
        isNull(ratings.deletedAt),
        or(
          eq(ratings.customerId, targetUserId),
          eq(ratings.driverId, targetUserId),
          eq(ratings.merchantId, targetUserId)
        )
      ))
      .orderBy(desc(ratings.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: userRatings,
      pagination: {
        page,
        limit,
        hasNext: userRatings.length === limit,
        hasPrevious: page > 1
      }
    });

  } catch (error) {
    console.error('Get user ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user ratings'
    });
  }
});

// GET /api/ratings/order/:id - List ratings by order
router.get('/order/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Verify order exists and user has permission to view its ratings
    const [order] = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check permissions
    const canView = userRole === 'ADMIN' || 
                   order.customerId === userId ||
                   order.driverId === userId ||
                   order.merchantId === userId;

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const orderRatings = await db
      .select({
        id: ratings.id,
        customerId: ratings.customerId,
        customerName: users.fullName,
        orderId: ratings.orderId,
        driverId: ratings.driverId,
        merchantId: ratings.merchantId,
        productId: ratings.productId,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(and(
        eq(ratings.orderId, orderId),
        isNull(ratings.deletedAt)
      ))
      .orderBy(desc(ratings.createdAt));

    res.json({
      success: true,
      data: orderRatings
    });

  } catch (error) {
    console.error('Get order ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order ratings'
    });
  }
});

// PUT /api/ratings/:id - Update a rating
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const ratingId = parseInt(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isNaN(ratingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rating ID'
      });
    }

    const validatedData = updateRatingSchema.parse(req.body);

    // Check if rating exists
    const [existingRating] = await db
      .select()
      .from(ratings)
      .where(and(
        eq(ratings.id, ratingId),
        isNull(ratings.deletedAt)
      ))
      .limit(1);

    if (!existingRating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found'
      });
    }

    // Only the customer who created the rating or admin can update it
    if (userRole !== 'ADMIN' && existingRating.customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the rating creator or admin can update this rating'
      });
    }

    const [updatedRating] = await db
      .update(ratings)
      .set(validatedData)
      .where(eq(ratings.id, ratingId))
      .returning();

    // Create audit log
    await createAuditLog(userId!, 'RATING_UPDATED', ratingId, {
      changes: validatedData,
      previousRating: existingRating.rating
    });

    res.json({
      success: true,
      message: 'Rating updated successfully',
      data: updatedRating
    });

  } catch (error) {
    console.error('Update rating error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update rating'
    });
  }
});

// DELETE /api/ratings/:id - Soft delete a rating
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const ratingId = parseInt(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (isNaN(ratingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rating ID'
      });
    }

    // Check if rating exists
    const [existingRating] = await db
      .select()
      .from(ratings)
      .where(and(
        eq(ratings.id, ratingId),
        isNull(ratings.deletedAt)
      ))
      .limit(1);

    if (!existingRating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found'
      });
    }

    // Only the customer who created the rating or admin can delete it
    if (userRole !== 'ADMIN' && existingRating.customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the rating creator or admin can delete this rating'
      });
    }

    await db
      .update(ratings)
      .set({ deletedAt: new Date() })
      .where(eq(ratings.id, ratingId));

    // Create audit log
    await createAuditLog(userId!, 'RATING_DELETED', ratingId, {
      rating: existingRating.rating,
      orderId: existingRating.orderId
    });

    res.json({
      success: true,
      message: 'Rating deleted successfully'
    });

  } catch (error) {
    console.error('Delete rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete rating'
    });
  }
});

export default router;
