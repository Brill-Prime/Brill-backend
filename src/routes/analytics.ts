
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { orders, users, transactions, driverProfiles } from '../db/schema';
import { eq, and, desc, gte, lte, sql, count, sum, avg, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin, requireRole } from '../utils/auth';

const router = express.Router();

const analyticsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('monthly')
});

// GET /api/analytics/dashboard - Get dashboard analytics
router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = analyticsQuerySchema.parse(req.query);
    const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    // Get key metrics
    const [orderStats] = await db
      .select({
        totalOrders: count(),
        totalRevenue: sum(orders.totalAmount),
        avgOrderValue: avg(orders.totalAmount)
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startDate),
        lte(orders.createdAt, endDate),
        isNull(orders.deletedAt)
      ));

    const [userStats] = await db
      .select({
        totalUsers: count(),
        activeUsers: count(sql`CASE WHEN ${users.lastLoginAt} >= ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)} THEN 1 END`)
      })
      .from(users)
      .where(isNull(users.deletedAt));

    const [driverStats] = await db
      .select({
        totalDrivers: count(),
        activeDrivers: count(sql`CASE WHEN ${driverProfiles.isOnline} = true THEN 1 END`),
        availableDrivers: count(sql`CASE WHEN ${driverProfiles.isAvailable} = true THEN 1 END`)
      })
      .from(driverProfiles)
      .where(isNull(driverProfiles.deletedAt));

    res.json({
      success: true,
      data: {
        period: {
          start: startDate,
          end: endDate
        },
        orders: {
          total: Number(orderStats.totalOrders) || 0,
          revenue: Number(orderStats.totalRevenue) || 0,
          avgValue: Number(orderStats.avgOrderValue) || 0
        },
        users: {
          total: Number(userStats.totalUsers) || 0,
          active: Number(userStats.activeUsers) || 0
        },
        drivers: {
          total: Number(driverStats.totalDrivers) || 0,
          online: Number(driverStats.activeDrivers) || 0,
          available: Number(driverStats.availableDrivers) || 0
        }
      }
    });

  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
});

// GET /api/analytics/orders - Get order analytics
router.get('/orders', requireAuth, requireRole(['ADMIN', 'MERCHANT']), async (req, res) => {
  try {
    const query = analyticsQuerySchema.parse(req.query);
    const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    // Order status distribution
    const statusDistribution = await db
      .select({
        status: orders.status,
        count: count()
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startDate),
        lte(orders.createdAt, endDate),
        isNull(orders.deletedAt)
      ))
      .groupBy(orders.status);

    // Daily order trends
    const dailyTrends = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        orders: count(),
        revenue: sum(orders.totalAmount)
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startDate),
        lte(orders.createdAt, endDate),
        isNull(orders.deletedAt)
      ))
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(sql`DATE(${orders.createdAt})`);

    res.json({
      success: true,
      data: {
        statusDistribution,
        dailyTrends: dailyTrends.map(trend => ({
          date: trend.date,
          orders: Number(trend.orders),
          revenue: Number(trend.revenue) || 0
        }))
      }
    });

  } catch (error) {
    console.error('Order analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order analytics'
    });
  }
});

export default router;
