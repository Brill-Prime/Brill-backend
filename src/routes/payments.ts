import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';
import PaystackService from '../services/paystack';
import { db } from '../db/config';
import { transactions, users, auditLogs, orders } from '../db/schema';
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
          status: 'COMPLETED'
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

// GET /api/payments/status/:reference - Get payment status
router.get('/status/:reference', requireAuth, async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user!.id;

    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paystackTransactionId, reference))
      .limit(1);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Verify user owns this transaction
    if (transaction.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    res.json({
      success: true,
      data: {
        reference: transaction.paystackTransactionId,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt
      }
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment status'
    });
  }
});

// POST /api/payments/refund - Request refund
router.post('/refund', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { transactionId, reason } = req.body;

    if (!transactionId || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID and reason are required'
      });
    }

    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (transaction.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access'
      });
    }

    if (transaction.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'Only completed transactions can be refunded'
      });
    }

    // Update transaction status to refund pending
    await db
      .update(transactions)
      .set({
        status: 'REFUNDED',
        metadata: {
          ...(transaction.metadata as any || {}),
          refundReason: reason,
          refundRequestedAt: new Date().toISOString()
        }
      })
      .where(eq(transactions.id, transactionId));

    // Log audit
    await db.insert(auditLogs).values({
      userId,
      action: 'REFUND_REQUESTED',
      entityType: 'TRANSACTION',
      entityId: transactionId,
      details: { reason, transactionRef: transaction.transactionRef }
    });

    res.json({
      success: true,
      message: 'Refund request submitted successfully'
    });
  } catch (error) {
    console.error('Refund request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process refund request'
    });
  }
});

// POST /api/payments/initiate - Initialize payment
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { orderId, amount, paymentMethod, bankAccountId } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and amount are required'
      });
    }

    // Validate payment method
    if (!paymentMethod || !['card', 'bank_transfer'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method. Use "card" or "bank_transfer"'
      });
    }

    // Get order details
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify order belongs to user
    if (order.customerId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Initialize payment with Paystack (supports both card and bank transfer)
    const paymentData = await PaystackService.initializeTransaction(
      amount,
      req.user!.email,
      {
        orderId,
        userId,
        paymentMethod,
        bankAccountId
      }
    );

    res.json({
      success: true,
      data: paymentData,
      message: paymentMethod === 'bank_transfer'
        ? 'Bank transfer details generated. Complete payment to proceed.'
        : 'Card payment initiated. Complete payment to proceed.'
    });
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment'
    });
  }
});

// POST /api/payments/create-intent - Create payment intent
router.post('/create-intent', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { amount, currency = 'NGN', orderId, metadata } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Get user email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create payment intent with Paystack
    const result = await PaystackService.initializeTransaction(
      user.email,
      amount,
      {
        orderId,
        userId,
        ...metadata
      }
    );

    if (result.status) {
      // Create transaction record
      await db.insert(transactions).values({
        userId,
        orderId,
        amount: amount.toString(),
        currency,
        type: 'PAYMENT',
        status: 'PENDING',
        paymentMethod: 'PAYSTACK',
        paystackTransactionId: result.data.reference,
        transactionRef: result.data.reference,
        metadata: metadata || {}
      });

      res.json({
        success: true,
        data: {
          reference: result.data.reference,
          authorizationUrl: result.data.authorization_url,
          accessCode: result.data.access_code,
          amount,
          currency
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message || 'Failed to create payment intent'
      });
    }
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment intent',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// POST /api/payments/process - Process payment
router.post('/process', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    // First, get the transaction to verify ownership
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.paystackTransactionId, reference))
      .limit(1);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // CRITICAL: Verify the transaction belongs to the authenticated user
    if (transaction.userId !== userId) {
      // Log the unauthorized attempt for security auditing
      await db.insert(auditLogs).values({
        userId,
        action: 'UNAUTHORIZED_PAYMENT_PROCESS_ATTEMPT',
        entityType: 'TRANSACTION',
        details: { 
          reference, 
          attemptedUserId: userId,
          actualUserId: transaction.userId 
        }
      });

      return res.status(403).json({
        success: false,
        message: 'Unauthorized: This transaction does not belong to you'
      });
    }

    // Verify payment with Paystack
    const result = await PaystackService.verifyTransaction(reference);

    if (result.status && result.data.status === 'success') {
      // Update transaction status
      await db
        .update(transactions)
        .set({
          status: 'COMPLETED',
          completedAt: new Date()
        })
        .where(eq(transactions.id, transaction.id));

      // If orderId is in transaction, verify order ownership and update
      if (transaction.orderId) {
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, transaction.orderId))
          .limit(1);

        // Only update order if it exists and belongs to the user
        if (order && order.customerId === userId) {
          await db
            .update(orders)
            .set({
              status: 'CONFIRMED',
              updatedAt: new Date()
            })
            .where(eq(orders.id, transaction.orderId));
        }
      }

      // Log audit
      await db.insert(auditLogs).values({
        userId,
        action: 'PAYMENT_COMPLETED',
        entityType: 'TRANSACTION',
        details: { 
          reference, 
          amount: result.data.amount / 100, 
          orderId: transaction.orderId 
        }
      });

      res.json({
        success: true,
        message: 'Payment processed successfully',
        data: {
          reference,
          amount: result.data.amount / 100,
          currency: result.data.currency,
          status: result.data.status,
          paidAt: result.data.paid_at
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        data: result.data
      });
    }
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;