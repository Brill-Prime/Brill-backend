
import express from 'express';
import { db } from '../db/config';
import { orders, ratings, products, users, merchantProfiles } from '../db/schema';
import { eq, and, desc, sql, gte, lte, isNull } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// GET /api/merchants/:id/analytics - Get merchant analytics
router.get('/:id/analytics', requireAuth, async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);
    const { startDate, endDate } = req.query;

    if (isNaN(merchantId)) {
      return res.status(400).json({ success: false, message: 'Invalid merchant ID' });
    }

    // Check if user has access (merchant themselves or admin)
    const userRole = req.user!.role;
    if (userRole !== 'ADMIN' && req.user!.id !== merchantId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Build date filter
    const dateFilters = [];
    if (startDate) {
      dateFilters.push(gte(orders.createdAt, new Date(startDate as string)));
    }
    if (endDate) {
      dateFilters.push(lte(orders.createdAt, new Date(endDate as string)));
    }

    // Get total sales
    const salesResult = await db
      .select({
        totalOrders: sql<number>`COUNT(*)`,
        totalRevenue: sql<number>`SUM(${orders.totalAmount})`,
        avgOrderValue: sql<number>`AVG(${orders.totalAmount})`
      })
      .from(orders)
      .where(and(
        eq(orders.merchantId, merchantId),
        eq(orders.status, 'DELIVERED'),
        ...dateFilters
      ));

    // Get product performance
    const productPerformance = await db
      .select({
        productId: products.id,
        productName: products.name,
        orderCount: sql<number>`COUNT(*)`,
        revenue: sql<number>`SUM(${orders.totalAmount})`
      })
      .from(orders)
      .innerJoin(products, eq(orders.merchantId, products.merchantId))
      .where(and(
        eq(orders.merchantId, merchantId),
        eq(orders.status, 'DELIVERED'),
        ...dateFilters
      ))
      .groupBy(products.id, products.name)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    // Get ratings summary
    const ratingsResult = await db
      .select({
        avgRating: sql<number>`AVG(${ratings.rating})`,
        totalRatings: sql<number>`COUNT(*)`
      })
      .from(ratings)
      .where(eq(ratings.merchantId, merchantId));

    res.json({
      success: true,
      data: {
        sales: {
          totalOrders: parseInt(salesResult[0]?.totalOrders as any) || 0,
          totalRevenue: parseFloat(salesResult[0]?.totalRevenue as any) || 0,
          avgOrderValue: parseFloat(salesResult[0]?.avgOrderValue as any) || 0
        },
        topProducts: productPerformance,
        ratings: {
          average: parseFloat(ratingsResult[0]?.avgRating as any) || 0,
          total: parseInt(ratingsResult[0]?.totalRatings as any) || 0
        }
      }
    });
  } catch (error) {
    console.error('Get merchant analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to get merchant analytics' });
  }
});

// GET /api/merchants/:id/reviews - Get merchant reviews
router.get('/:id/reviews', async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    if (isNaN(merchantId)) {
      return res.status(400).json({ success: false, message: 'Invalid merchant ID' });
    }

    const reviews = await db
      .select({
        id: ratings.id,
        rating: ratings.rating,
        comment: ratings.comment,
        createdAt: ratings.createdAt,
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber
        },
        customer: {
          id: users.id,
          fullName: users.fullName,
          profilePicture: users.profilePicture
        }
      })
      .from(ratings)
      .leftJoin(orders, eq(ratings.orderId, orders.id))
      .leftJoin(users, eq(ratings.customerId, users.id))
      .where(eq(ratings.merchantId, merchantId))
      .orderBy(desc(ratings.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(ratings)
      .where(eq(ratings.merchantId, merchantId));

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page,
        limit,
        total: parseInt(count as any),
        totalPages: Math.ceil(parseInt(count as any) / limit)
      }
    });
  } catch (error) {
    console.error('Get merchant reviews error:', error);
    res.status(500).json({ success: false, message: 'Failed to get merchant reviews' });
  }
});

// POST /api/merchants/:id/reviews/:reviewId/reply - Reply to review
router.post('/:id/reviews/:reviewId/reply', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);
    const reviewId = parseInt(req.params.reviewId);
    const { reply } = req.body;

    if (isNaN(merchantId) || isNaN(reviewId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    if (!reply) {
      return res.status(400).json({ success: false, message: 'Reply text is required' });
    }

    // Check if user is the merchant or admin
    if (req.user!.role !== 'ADMIN' && req.user!.id !== merchantId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const [rating] = await db
      .select()
      .from(ratings)
      .where(eq(ratings.id, reviewId))
      .limit(1);

    if (!rating || rating.merchantId !== merchantId) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    const [updatedRating] = await db
      .update(ratings)
      .set({
        merchantReply: reply,
        merchantRepliedAt: new Date()
      })
      .where(eq(ratings.id, reviewId))
      .returning();

    res.json({
      success: true,
      message: 'Reply posted successfully',
      data: updatedRating
    });
  } catch (error) {
    console.error('Reply to review error:', error);
    res.status(500).json({ success: false, message: 'Failed to post reply' });
  }
});

export default router;
