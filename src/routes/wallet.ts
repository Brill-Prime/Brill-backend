
import express from 'express';
import { db } from '../db/config';
import { users, transactions, auditLogs } from '../db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

const fundWalletSchema = z.object({
  amount: z.number().positive(),
  paymentReference: z.string().min(1)
});

const withdrawSchema = z.object({
  amount: z.number().positive(),
  bankAccountId: z.number().int().positive()
});

// GET /api/wallet/balance - Get wallet balance
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select({
        walletBalance: users.walletBalance,
        currency: users.currency
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
      data: {
        balance: parseFloat(user.walletBalance || '0'),
        currency: user.currency || 'NGN'
      }
    });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet balance'
    });
  }
});

// POST /api/wallet/fund - Fund wallet
router.post('/fund', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = fundWalletSchema.parse(req.body);

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

    const currentBalance = parseFloat(user.walletBalance || '0');
    const newBalance = currentBalance + validatedData.amount;

    await db
      .update(users)
      .set({
        walletBalance: newBalance.toString(),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Create transaction record
    await db.insert(transactions).values({
      userId,
      amount: validatedData.amount.toString(),
      type: 'WALLET_FUNDING',
      status: 'COMPLETED',
      transactionRef: validatedData.paymentReference,
      description: 'Wallet funding',
      completedAt: new Date()
    });

    // Log audit event
    await db.insert(auditLogs).values({
      userId,
      action: 'WALLET_FUNDED',
      entityType: 'WALLET',
      entityId: userId,
      details: { amount: validatedData.amount }
    });

    res.json({
      success: true,
      message: 'Wallet funded successfully',
      data: {
        newBalance,
        amount: validatedData.amount
      }
    });
  } catch (error) {
    console.error('Fund wallet error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fund wallet'
    });
  }
});

// POST /api/wallet/withdraw - Withdraw from wallet
router.post('/withdraw', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = withdrawSchema.parse(req.body);

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

    const currentBalance = parseFloat(user.walletBalance || '0');

    if (currentBalance < validatedData.amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    const newBalance = currentBalance - validatedData.amount;

    await db
      .update(users)
      .set({
        walletBalance: newBalance.toString(),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Create withdrawal transaction
    const [transaction] = await db.insert(transactions).values({
      userId,
      amount: validatedData.amount.toString(),
      type: 'WITHDRAWAL',
      status: 'PENDING',
      description: 'Wallet withdrawal',
      metadata: { bankAccountId: validatedData.bankAccountId }
    }).returning();

    res.json({
      success: true,
      message: 'Withdrawal request submitted',
      data: {
        transactionId: transaction.id,
        newBalance,
        amount: validatedData.amount
      }
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal'
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
      .select()
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt)
      ))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: walletTransactions
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
