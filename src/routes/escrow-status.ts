
import express from 'express';
import { db } from '../db/config';
import { escrows, orders, transactions } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// GET /api/escrow-status/:orderId - Get escrow status for an order
router.get('/:orderId', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const currentUser = req.user!;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Get order
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

    // Verify user is involved in the order
    const isInvolved = [order.customerId, order.merchantId, order.driverId].includes(currentUser.id);
    if (!isInvolved && currentUser.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get escrow
    const [escrow] = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.orderId, orderId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!escrow) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found for this order'
      });
    }

    // Get related transactions
    const escrowTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, escrow.transactionRef!));

    // Calculate time until auto-release
    let hoursUntilAutoRelease = null;
    if (order.confirmationDeadline && escrow.status === 'HELD') {
      const msUntilRelease = new Date(order.confirmationDeadline).getTime() - Date.now();
      hoursUntilAutoRelease = Math.max(0, Math.floor(msUntilRelease / (1000 * 60 * 60)));
    }

    res.json({
      success: true,
      data: {
        escrow: {
          id: escrow.id,
          status: escrow.status,
          amount: escrow.amount,
          createdAt: escrow.createdAt,
          releasedAt: escrow.releasedAt
        },
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          deliveredAt: order.deliveredAt,
          confirmationDeadline: order.confirmationDeadline
        },
        transactions: escrowTransactions,
        autoRelease: {
          enabled: !!order.confirmationDeadline,
          hoursRemaining: hoursUntilAutoRelease,
          willReleaseAt: order.confirmationDeadline
        }
      }
    });
  } catch (error) {
    console.error('Get escrow status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get escrow status'
    });
  }
});

export default router;
