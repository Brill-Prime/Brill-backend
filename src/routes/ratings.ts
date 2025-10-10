import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { ratings, users, orders } from '../db/schema';
import { eq, and, desc, sql, or } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createRatingSchema = z.object({
  orderId: z.number().int().positive(),
  ratedUserId: z.number().int().positive(),
  ratingType: z.enum(['DRIVER', 'MERCHANT']),
  rating: z.number().min(1).max(5),
  comment: z.string().optional()
});

const updateRatingSchema = z.object({
  rating: z.number().min(1).max(5).optional(),
  comment: z.string().optional()
});

// Create rating
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = (req.session as any).userId;
    const ratingData = createRatingSchema.parse(req.body);

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, ratingData.orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    if (order.customerId !== userId) {
        return res.status(403).json({
            success: false,
            message: 'You are not authorized to rate this order'
        });
    }

    const existingRatingQuery = [
        eq(ratings.orderId, ratingData.orderId),
        eq(ratings.customerId, userId)
    ];
    if (ratingData.ratingType === 'DRIVER') {
        existingRatingQuery.push(eq(ratings.driverId, ratingData.ratedUserId));
    } else { // MERCHANT
        existingRatingQuery.push(eq(ratings.merchantId, ratingData.ratedUserId));
    }

    const [existingRating] = await db
      .select()
      .from(ratings)
      .where(and(...existingRatingQuery))
      .limit(1);

    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a rating for this entity on this order'
      });
    }
    
    const dataToInsert: any = {
        orderId: ratingData.orderId,
        rating: ratingData.rating,
        comment: ratingData.comment,
        customerId: userId,
        createdAt: new Date()
    };

    if (ratingData.ratingType === 'DRIVER') {
        dataToInsert.driverId = ratingData.ratedUserId;
    } else { // MERCHANT
        dataToInsert.merchantId = ratingData.ratedUserId;
    }

    const newRatings = await db
      .insert(ratings)
      .values(dataToInsert)
      .returning();

    res.status(201).json({
      success: true,
      rating: newRatings[0]
    });
  } catch (error: any) {
    console.error('Create rating error:', error);
    if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: 'Invalid data', errors: error.issues });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create rating'
    });
  }
});

// Get ratings for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    const userRatings = await db
      .select({
        id: ratings.id,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt,
        rater: {
          id: users.id,
          fullName: users.fullName,
          profilePicture: users.profilePicture
        }
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(or(eq(ratings.driverId, userId), eq(ratings.merchantId, userId)))
      .orderBy(desc(ratings.createdAt));

    const avgResult = await db
      .select({
        avg: sql<number>`AVG(${ratings.rating})`.mapWith(Number),
        count: sql<number>`COUNT(*)`
      })
      .from(ratings)
      .where(or(eq(ratings.driverId, userId), eq(ratings.merchantId, userId)));

    res.json({
      success: true,
      ratings: userRatings,
      average: avgResult[0]?.avg || 0,
      total: parseInt(avgResult[0]?.count as any || '0')
    });
  } catch (error: any) {
    console.error('Get ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ratings'
    });
  }
});

// Get rating by ID
router.get('/:id', async (req, res) => {
  try {
    const ratingId = parseInt(req.params.id);

    const [rating] = await db
      .select()
      .from(ratings)
      .where(eq(ratings.id, ratingId))
      .limit(1);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found'
      });
    }

    res.json({
      success: true,
      rating
    });
  } catch (error: any) {
    console.error('Get rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get rating'
    });
  }
});

// Update rating
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const ratingId = parseInt(req.params.id);
    const userId = (req.session as any).userId;
    const updateData = updateRatingSchema.parse(req.body);

    const [rating] = await db
      .select()
      .from(ratings)
      .where(eq(ratings.id, ratingId))
      .limit(1);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found'
      });
    }

    if (rating.customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this rating'
      });
    }

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ success: false, message: 'No update data provided' });
    }

    const updatedRatings = await db
      .update(ratings)
      .set(updateData)
      .where(eq(ratings.id, ratingId))
      .returning();

    res.json({
      success: true,
      rating: updatedRatings[0]
    });
  } catch (error: any) {
    console.error('Update rating error:', error);
    if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: 'Invalid data', errors: error.issues });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update rating'
    });
  }
});

// Delete rating
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const ratingId = parseInt(req.params.id);
    const userId = (req.session as any).userId;

    const [rating] = await db
      .select()
      .from(ratings)
      .where(eq(ratings.id, ratingId))
      .limit(1);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found'
      });
    }

    if (rating.customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this rating'
      });
    }

    await db
      .delete(ratings)
      .where(eq(ratings.id, ratingId));

    res.json({
      success: true,
      message: 'Rating deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete rating'
    });
  }
});

// GET /api/ratings/driver/:driverId - Get driver ratings
router.get('/driver/:driverId', requireAuth, async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    
    if (isNaN(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID'
      });
    }

    const driverRatings = await db
      .select({
        rating: ratings,
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber
        },
        rater: {
          id: users.id,
          fullName: users.fullName
        }
      })
      .from(ratings)
      .leftJoin(orders, eq(ratings.orderId, orders.id))
      .leftJoin(users, eq(ratings.raterId, users.id))
      .where(eq(ratings.ratedId, driverId))
      .orderBy(desc(ratings.createdAt));

    const avgRating = driverRatings.length > 0
      ? driverRatings.reduce((sum, r) => sum + r.rating.rating, 0) / driverRatings.length
      : 0;

    res.json({
      success: true,
      data: driverRatings,
      summary: {
        averageRating: avgRating.toFixed(2),
        totalRatings: driverRatings.length
      }
    });
  } catch (error) {
    console.error('Get driver ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve driver ratings'
    });
  }
});

// GET /api/ratings/merchant/:merchantId - Get merchant ratings
router.get('/merchant/:merchantId', requireAuth, async (req, res) => {
  try {
    const merchantId = parseInt(req.params.merchantId);
    
    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    const merchantRatings = await db
      .select({
        rating: ratings,
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber
        },
        rater: {
          id: users.id,
          fullName: users.fullName
        }
      })
      .from(ratings)
      .leftJoin(orders, eq(ratings.orderId, orders.id))
      .leftJoin(users, eq(ratings.raterId, users.id))
      .where(eq(ratings.ratedId, merchantId))
      .orderBy(desc(ratings.createdAt));

    const avgRating = merchantRatings.length > 0
      ? merchantRatings.reduce((sum, r) => sum + r.rating.rating, 0) / merchantRatings.length
      : 0;

    res.json({
      success: true,
      data: merchantRatings,
      summary: {
        averageRating: avgRating.toFixed(2),
        totalRatings: merchantRatings.length
      }
    });
  } catch (error) {
    console.error('Get merchant ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant ratings'
    });
  }
});

export default router;
