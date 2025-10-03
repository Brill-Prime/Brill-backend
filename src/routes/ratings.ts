import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { ratings, users, orders } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createRatingSchema = z.object({
  orderId: z.number().int().positive(),
  ratedUserId: z.number().int().positive(),
  ratingType: z.enum(['DRIVER', 'MERCHANT', 'CONSUMER']),
  score: z.number().min(1).max(5),
  comment: z.string().optional()
});

const updateRatingSchema = z.object({
  score: z.number().min(1).max(5).optional(),
  comment: z.string().optional()
});

// Create rating
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = (req.session as any).userId;
    const ratingData = createRatingSchema.parse(req.body);

    // Verify order exists and user is part of it
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

    // Check if user already rated this order
    const [existingRating] = await db
      .select()
      .from(ratings)
      .where(and(
        eq(ratings.orderId, ratingData.orderId),
        eq(ratings.raterUserId, userId)
      ))
      .limit(1);

    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this order'
      });
    }

    const newRatings = await db
      .insert(ratings)
      .values({
        ...ratingData,
        raterUserId: userId,
        createdAt: new Date()
      })
      .returning();

    res.status(201).json({
      success: true,
      rating: newRatings[0]
    });
  } catch (error: any) {
    console.error('Create rating error:', error);
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
        score: ratings.score,
        comment: ratings.comment,
        ratingType: ratings.ratingType,
        createdAt: ratings.createdAt,
        rater: {
          id: users.id,
          fullName: users.fullName,
          profilePicture: users.profilePicture
        }
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.raterUserId, users.id))
      .where(eq(ratings.ratedUserId, userId))
      .orderBy(desc(ratings.createdAt));

    // Calculate average rating
    const avgResult = await db
      .select({
        avg: sql<number>`AVG(${ratings.score})`,
        count: sql<number>`COUNT(*)`
      })
      .from(ratings)
      .where(eq(ratings.ratedUserId, userId));

    res.json({
      success: true,
      ratings: userRatings,
      average: avgResult[0]?.avg || 0,
      total: avgResult[0]?.count || 0
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

    if (rating.raterUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this rating'
      });
    }

    const updatedRatings = await db
      .update(ratings)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(ratings.id, ratingId))
      .returning();

    res.json({
      success: true,
      rating: updatedRatings[0]
    });
  } catch (error: any) {
    console.error('Update rating error:', error);
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

    if (rating.raterUserId !== userId) {
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

export default router;