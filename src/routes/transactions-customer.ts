import express from 'express';
import { db } from '../db/config';
import { transactions, users } from '../db/schema';
import { eq, and, isNull, desc, gte, lte } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// GET /api/transactions/customer - Get customer transactions
router.get('/transactions/customer', requireAuth, requireRole(['CONSUMER', 'ADMIN']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const offset = (page - 1) * limit;
    const conditions = [isNull(transactions.deletedAt)];

    // Customers see only their own transactions
    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(transactions.userId, currentUser.id));
    }

    if (type) {
      conditions.push(eq(transactions.type, type as any));
    }

    if (status) {
      conditions.push(eq(transactions.status, status as any));
    }

    if (startDate) {
      conditions.push(gte(transactions.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(transactions.createdAt, new Date(endDate)));
    }

    const customerTransactions = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    const totalCount = await db
      .select({ count: transactions.id })
      .from(transactions)
      .where(and(...conditions));

    const totalSpent = customerTransactions
      .filter(t => t.status === 'COMPLETED' && t.type === 'PAYMENT')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    res.json({
      success: true,
      data: customerTransactions,
      summary: {
        totalSpent,
        totalTransactions: totalCount.length
      },
      pagination: {
        page,
        limit,
        total: totalCount.length,
        pages: Math.ceil(totalCount.length / limit)
      }
    });
  } catch (error) {
    console.error('Get customer transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve customer transactions'
    });
  }
});

export default router;
