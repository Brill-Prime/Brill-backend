
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';
import PaystackService from '../services/paystack';
import { db } from '../db/config';
import { transactions, users, auditLogs } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

// Validation schemas
const initializePaymentSchema = z.object({
  amount: z.number().positive(),
  email: z.string().email(),
  orderId: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

const verifyPaymentSchema = z.object({
  reference: z.string().min(1)
});

// POST /api/payments/initialize - Initialize payment
router.post('/initialize', requireAuth, async (req, res) => {
  try {
    const paymentData = initializePaymentSchema.parse(req.body);
    const userId = req.user!.id;

    const result = await PaystackService.initializeTransaction(
      paymentData.email,
      paymentData.amount,
      paymentData.metadata
    );

    if (result.status) {
      // Create transaction record
      await db.insert(transactions).values({
        userId,
        orderId: paymentData.orderId,
        amount: paymentData.amount.toString(),
        currency: 'NGN',
        type: 'PAYMENT',
        status: 'PENDING',
        paymentMethod: 'PAYSTACK',
        paystackTransactionId: result.data.reference,
        transactionRef: result.data.reference,
        metadata: paymentData.metadata || {}
      });

      // Log audit
      await db.insert(auditLogs).values({
        userId,
        action: 'PAYMENT_INITIALIZED',
        entityType: 'TRANSACTION',
        details: { reference: result.data.reference, amount: paymentData.amount }
      });

      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message || 'Failed to initialize payment'
      });
    }
  } catch (error) {
    console.error('Initialize payment error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment'
    });
  }
});

// GET /api/payments/verify/:reference - Verify payment
router.get('/verify/:reference', requireAuth, async (req, res) => {
  try {
    const { reference } = req.params;

    const result = await PaystackService.verifyTransaction(reference);

    if (result.status && result.data.status === 'success') {
      // Update transaction status
      await db
        .update(transactions)
        .set({
          status: 'COMPLETED',
          updatedAt: new Date()
        })
        .where(eq(transactions.paystackTransactionId, reference));

      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
});

// GET /api/payments/history - Get user payment history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const userTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: userTransactions,
      pagination: {
        page,
        limit,
        total: userTransactions.length
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history'
    });
  }
});

export default router;
