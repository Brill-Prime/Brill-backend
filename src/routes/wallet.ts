
import express from 'express';
import { db } from '../db/config';
import { users, transactions, auditLogs } from '../db/schema';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const topupSchema = z.object({
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }),
  paymentMethod: z.string().min(1)
});

const withdrawSchema = z.object({
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }),
  bankAccount: z.string().min(1)
});

const transferSchema = z.object({
  recipientId: z.number().int().positive(),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }),
  description: z.string().optional()
});

// Helper function to log audit events
const logAuditEvent = async (userId: number, action: string, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'WALLET',
      details
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

// GET /api/wallet/balance - Get user wallet balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select({
        id: users.id,
        walletBalance: users.walletBalance
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      balance: user.walletBalance || '0.00',
      currency: 'NGN'
    });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet balance'
    });
  }
});

// POST /api/wallet/topup - Add funds to wallet
router.post('/topup', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = topupSchema.parse(req.body);

    // Create transaction record
    const transactionRef = `TOP_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    const [transaction] = await db.insert(transactions).values({
      userId,
      amount: validatedData.amount,
      currency: 'NGN',
      type: 'TRANSFER_IN',
      paymentMethod: validatedData.paymentMethod,
      transactionRef,
      status: 'PENDING',
      description: 'Wallet top-up',
      initiatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(userId, 'WALLET_TOPUP_INITIATED', {
      amount: validatedData.amount,
      transactionRef
    });

    res.status(201).json({
      success: true,
      message: 'Wallet top-up initiated',
      transaction: {
        id: transaction.id,
        transactionRef: transaction.transactionRef,
        amount: transaction.amount,
        status: transaction.status
      }
    });
  } catch (error) {
    console.error('Wallet top-up error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to initiate wallet top-up'
    });
  }
});

// POST /api/wallet/withdraw - Withdraw funds from wallet
router.post('/withdraw', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = withdrawSchema.parse(req.body);

    // Check wallet balance
    const [user] = await db
      .select({ walletBalance: users.walletBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentBalance = Number(user.walletBalance || '0');
    const withdrawAmount = Number(validatedData.amount);

    if (currentBalance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // Create withdrawal transaction
    const transactionRef = `WTH_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    const [transaction] = await db.insert(transactions).values({
      userId,
      amount: validatedData.amount,
      currency: 'NGN',
      type: 'TRANSFER_OUT',
      paymentMethod: 'BANK_TRANSFER',
      transactionRef,
      status: 'PENDING',
      description: `Withdrawal to ${validatedData.bankAccount}`,
      metadata: { bankAccount: validatedData.bankAccount },
      initiatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(userId, 'WALLET_WITHDRAWAL_INITIATED', {
      amount: validatedData.amount,
      transactionRef,
      bankAccount: validatedData.bankAccount
    });

    res.status(201).json({
      success: true,
      message: 'Withdrawal initiated',
      transaction: {
        id: transaction.id,
        transactionRef: transaction.transactionRef,
        amount: transaction.amount,
        status: transaction.status
      }
    });
  } catch (error) {
    console.error('Wallet withdrawal error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to initiate withdrawal'
    });
  }
});

// POST /api/wallet/transfer - Transfer funds between users
router.post('/transfer', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = transferSchema.parse(req.body);

    // Check sender balance
    const [sender] = await db
      .select({ walletBalance: users.walletBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!sender) {
      return res.status(404).json({
        success: false,
        message: 'Sender not found'
      });
    }

    // Check recipient exists
    const [recipient] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, validatedData.recipientId))
      .limit(1);

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    const currentBalance = Number(sender.walletBalance || '0');
    const transferAmount = Number(validatedData.amount);

    if (currentBalance < transferAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // Create transfer transaction
    const transactionRef = `TRF_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    const [transaction] = await db.insert(transactions).values({
      userId,
      recipientId: validatedData.recipientId,
      amount: validatedData.amount,
      currency: 'NGN',
      type: 'TRANSFER_OUT',
      paymentMethod: 'WALLET',
      transactionRef,
      status: 'PENDING',
      description: validatedData.description || 'Wallet transfer',
      initiatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(userId, 'WALLET_TRANSFER_INITIATED', {
      amount: validatedData.amount,
      recipientId: validatedData.recipientId,
      transactionRef
    });

    res.status(201).json({
      success: true,
      message: 'Transfer initiated',
      transaction: {
        id: transaction.id,
        transactionRef: transaction.transactionRef,
        amount: transaction.amount,
        status: transaction.status
      }
    });
  } catch (error) {
    console.error('Wallet transfer error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to initiate transfer'
    });
  }
});

// GET /api/wallet/transactions - Get wallet transaction history
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const walletTransactions = await db
      .select({
        id: transactions.id,
        transactionRef: transactions.transactionRef,
        amount: transactions.amount,
        currency: transactions.currency,
        type: transactions.type,
        status: transactions.status,
        description: transactions.description,
        createdAt: transactions.createdAt
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt)
        )
      )
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt)
        )
      );

    res.json({
      success: true,
      transactions: walletTransactions,
      pagination: {
        page,
        limit,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limit)
      }
    });
  } catch (error) {
    console.error('Get wallet transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet transactions'
    });
  }
});

export default router;
