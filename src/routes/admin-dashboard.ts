
import express from 'express';
import { db } from '../db/config';
import { users, orders, driverProfiles, transactions, notifications } from '../db/schema';
import { eq, and, desc, gte, lte, sql, count, sum, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// GET /api/admin-dashboard/overview - Get admin dashboard overview
router.get('/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Today's stats
    const [todayStats] = await db
      .select({
        orders: count(),
        revenue: sum(orders.totalAmount)
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startOfDay),
        isNull(orders.deletedAt)
      ));

    // This week's stats
    const [weekStats] = await db
      .select({
        orders: count(),
        revenue: sum(orders.totalAmount)
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startOfWeek),
        isNull(orders.deletedAt)
      ));

    // This month's stats
    const [monthStats] = await db
      .select({
        orders: count(),
        revenue: sum(orders.totalAmount)
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, startOfMonth),
        isNull(orders.deletedAt)
      ));

    // Total counts
    const [totalCounts] = await db
      .select({
        totalUsers: count(sql`CASE WHEN ${users.role} = 'CUSTOMER' THEN 1 END`),
        totalMerchants: count(sql`CASE WHEN ${users.role} = 'MERCHANT' THEN 1 END`),
        totalDrivers: count(sql`CASE WHEN ${users.role} = 'DRIVER' THEN 1 END`)
      })
      .from(users)
      .where(isNull(users.deletedAt));

    // Active users (logged in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [activeUsers] = await db
      .select({
        count: count()
      })
      .from(users)
      .where(and(
        gte(users.lastLoginAt, sevenDaysAgo),
        isNull(users.deletedAt)
      ));

    // Driver status
    const [driverStatus] = await db
      .select({
        online: count(sql`CASE WHEN ${driverProfiles.isOnline} = true THEN 1 END`),
        available: count(sql`CASE WHEN ${driverProfiles.isAvailable} = true THEN 1 END`)
      })
      .from(driverProfiles)
      .where(isNull(driverProfiles.deletedAt));

    // Recent orders
    const recentOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        totalAmount: orders.totalAmount,
        status: orders.status,
        createdAt: orders.createdAt,
        customer: {
          fullName: users.fullName,
          email: users.email
        }
      })
      .from(orders)
      .leftJoin(users, eq(orders.customerId, users.id))
      .where(isNull(orders.deletedAt))
      .orderBy(desc(orders.createdAt))
      .limit(10);

    res.json({
      success: true,
      data: {
        stats: {
          today: {
            orders: Number(todayStats.orders) || 0,
            revenue: Number(todayStats.revenue) || 0
          },
          week: {
            orders: Number(weekStats.orders) || 0,
            revenue: Number(weekStats.revenue) || 0
          },
          month: {
            orders: Number(monthStats.orders) || 0,
            revenue: Number(monthStats.revenue) || 0
          }
        },
        totals: {
          users: Number(totalCounts.totalUsers) || 0,
          merchants: Number(totalCounts.totalMerchants) || 0,
          drivers: Number(totalCounts.totalDrivers) || 0,
          activeUsers: Number(activeUsers.count) || 0
        },
        drivers: {
          online: Number(driverStatus.online) || 0,
          available: Number(driverStatus.available) || 0
        },
        recentOrders: recentOrders.map(order => ({
          ...order,
          totalAmount: Number(order.totalAmount)
        }))
      }
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

// GET /api/admin-dashboard/alerts - Get system alerts
router.get('/alerts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alerts = [];

    // Check for failed orders in last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedOrders] = await db
      .select({ count: count() })
      .from(orders)
      .where(and(
        eq(orders.status, 'FAILED'),
        gte(orders.createdAt, yesterday)
      ));

    if (Number(failedOrders.count) > 5) {
      alerts.push({
        type: 'ERROR',
        title: 'High Failed Orders',
        message: `${failedOrders.count} orders failed in the last 24 hours`,
        priority: 'HIGH'
      });
    }

    // Check for offline drivers
    const [offlineDrivers] = await db
      .select({ count: count() })
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.isOnline, false),
        isNull(driverProfiles.deletedAt)
      ));

    if (Number(offlineDrivers.count) > Number(totalDrivers) * 0.8) {
      alerts.push({
        type: 'WARNING',
        title: 'Most Drivers Offline',
        message: `${offlineDrivers.count} drivers are currently offline`,
        priority: 'MEDIUM'
      });
    }

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('Admin alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts'
    });
  }
});

export default router;
