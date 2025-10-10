import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { escrows, orders, users, transactions } from '../db/schema';
import { eq, and, desc, sql, count, sum, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

const escrowActionSchema = z.object({
  action: z.enum(['RELEASE', 'REFUND', 'HOLD', 'DISPUTE']),
  reason: z.string(),
  notes: z.string().optional()
});

// GET /api/admin/escrow-management - Get all escrow transactions
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let whereConditions = [isNull(escrows.deletedAt)];
    if (status && ['PENDING', 'RELEASED', 'REFUNDED', 'DISPUTED'].includes(status)) {
      whereConditions.push(eq(escrows.status, status as any));
    }

    const escrowList = await db
      .select({
        id: escrows.id,
        orderId: escrows.orderId,
        amount: escrows.amount,
        status: escrows.status,
        holdUntil: escrows.holdUntil,
        createdAt: escrows.createdAt,
        order: {
          orderNumber: orders.orderNumber
        },
        buyer: {
          fullName: sql<string>`buyer.full_name`,
          email: sql<string>`buyer.email`
        }
      })
      .from(escrows)
      .leftJoin(orders, eq(escrows.orderId, orders.id))
      .leftJoin(users, eq(orders.customerId, users.id))
      .where(and(...whereConditions))
      .orderBy(desc(escrows.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(escrows)
      .where(and(...whereConditions));

    const [stats] = await db
      .select({
        totalHeld: sum(sql`CASE WHEN ${escrows.status} = 'PENDING' THEN ${escrows.amount} ELSE 0 END`),
        totalReleased: sum(sql`CASE WHEN ${escrows.status} = 'RELEASED' THEN ${escrows.amount} ELSE 0 END`),
        totalRefunded: sum(sql`CASE WHEN ${escrows.status} = 'REFUNDED' THEN ${escrows.amount} ELSE 0 END`)
      })
      .from(escrows)
      .where(isNull(escrows.deletedAt));

    res.json({
      success: true,
      data: escrowList,
      stats: {
        totalHeld: Number(stats.totalHeld) || 0,
        totalReleased: Number(stats.totalReleased) || 0,
        totalRefunded: Number(stats.totalRefunded) || 0
      },
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Escrow management error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch escrow data' });
  }
});

// POST /api/admin/escrow-management/:escrowId/action - Take action on escrow
router.post('/:escrowId/action', requireAuth, requireAdmin, async (req, res) => {
  try {
    const escrowId = parseInt(req.params.escrowId);
    const validatedData = escrowActionSchema.parse(req.body);

    const [escrow] = await db
      .select()
      .from(escrows)
      .where(eq(escrows.id, escrowId))
      .limit(1);

    if (!escrow) {
      return res.status(404).json({ success: false, message: 'Escrow not found' });
    }

    const newStatus = validatedData.action === 'RELEASE' ? 'RELEASED' : 
                      validatedData.action === 'REFUND' ? 'REFUNDED' : 
                      validatedData.action === 'DISPUTE' ? 'DISPUTED' : 'PENDING';

    await db
      .update(escrows)
      .set({
        status: newStatus,
        releasedAt: validatedData.action === 'RELEASE' ? new Date() : undefined
      })
      .where(eq(escrows.id, escrowId));

    res.json({
      success: true,
      message: `Escrow ${validatedData.action.toLowerCase()} completed successfully`
    });
  } catch (error) {
    console.error('Escrow action error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    res.status(500).json({ success: false, message: 'Failed to process escrow action' });
  }
});

export default router;
