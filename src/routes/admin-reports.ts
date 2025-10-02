import express from 'express';
import { db } from '../db/config';
import { users, orders, transactions } from '../db/schema';
import { eq, desc, count, sum, gte, lte, and, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Financial Reports
router.get('/financial', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();

    // Revenue analysis
    const [revenueData] = await db
      .select({
        totalRevenue: sum(transactions.amount),
        totalTransactions: count(transactions.id),
        avgTransactionValue: sql<number>`AVG(CAST(${transactions.amount} AS DECIMAL))`,
      })
      .from(transactions)
      .where(and(
        eq(transactions.status, 'COMPLETED'),
        gte(transactions.createdAt, start),
        lte(transactions.createdAt, end)
      ));

    // Order analysis
    const [orderData] = await db
      .select({
        totalOrders: count(orders.id),
        totalOrderValue: sum(orders.totalAmount)
      })
      .from(orders)
      .where(and(
        gte(orders.createdAt, start),
        lte(orders.createdAt, end)
      ));

    res.json({
      success: true,
      data: {
        period: { start, end },
        revenue: {
          total: Number(revenueData.totalRevenue) || 0,
          transactions: Number(revenueData.totalTransactions) || 0,
          average: Number(revenueData.avgTransactionValue) || 0
        },
        orders: {
          total: Number(orderData.totalOrders) || 0,
          value: Number(orderData.totalOrderValue) || 0
        }
      }
    });
  } catch (error) {
    console.error('Financial reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate financial reports' });
  }
});

// User Growth Reports
router.get('/user-growth', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const userGrowth = await db
      .select({
        date: sql<string>`DATE(${users.createdAt})`,
        role: users.role,
        count: count()
      })
      .from(users)
      .where(gte(users.createdAt, startDate))
      .groupBy(sql`DATE(${users.createdAt})`, users.role)
      .orderBy(desc(sql`DATE(${users.createdAt})`));

    const [activityStats] = await db
      .select({
        totalUsers: count(),
        verifiedUsers: count(sql`CASE WHEN ${users.isVerified} = true THEN 1 END`)
      })
      .from(users);

    res.json({
      success: true,
      data: {
        growth: userGrowth,
        stats: activityStats,
        period: `${days} days`
      }
    });
  } catch (error) {
    console.error('User growth reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate user growth reports' });
  }
});

// Platform Performance Reports
router.get('/performance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const performanceData = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: performanceData
    });
  } catch (error) {
    console.error('Performance reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate performance reports' });
  }
});

// Export reports
router.get('/export/:reportType', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { reportType } = req.params;
    const { format = 'csv', startDate, endDate } = req.query;

    const exportData = {
      reportType,
      format,
      dateRange: { startDate, endDate },
      downloadUrl: `/api/admin/downloads/report_${reportType}_${Date.now()}.${format}`,
      generatedAt: new Date()
    };

    res.json({
      success: true,
      data: exportData,
      message: 'Report export initiated'
    });
  } catch (error) {
    console.error('Export reports error:', error);
    res.status(500).json({ success: false, message: 'Failed to export report' });
  }
});

export default router;