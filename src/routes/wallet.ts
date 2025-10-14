import express from 'express';
import { db } from '../db/config';
import { users, transactions, auditLogs } from '../db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Note: This endpoint is deprecated. Users should use /api/bank-accounts for payment methods
router.get('/balance', requireAuth, async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Wallet functionality has been removed. Please use external payment methods.',
    code: 'WALLET_DEPRECATED'
  });
});

router.post('/fund', requireAuth, async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Wallet funding has been removed. Payments are processed directly through external payment methods.',
    code: 'WALLET_DEPRECATED'
  });
});

router.post('/withdraw', requireAuth, async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Wallet withdrawals have been removed. Payouts are sent directly to bank accounts.',
    code: 'WALLET_DEPRECATED'
  });
});

// GET /api/wallet/transactions - Redirect to general transactions
router.get('/transactions', requireAuth, async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Please use /api/transactions endpoint instead',
    code: 'WALLET_DEPRECATED'
  });
});

// POST /api/wallet/add-funds - Add funds to wallet
router.post('/add-funds', requireAuth, async (req, res) => {
  try {
    const addFundsSchema = z.object({
      amount: z.number().positive().min(100, 'Minimum amount is 100'),
      paymentMethod: z.enum(['CARD', 'BANK_TRANSFER', 'USSD'])
    });

    const validatedData = addFundsSchema.parse(req.body);
    const { amount, paymentMethod } = validatedData;

    // Placeholder for actual wallet funding logic
    // In a real application, this would involve interacting with a payment gateway
    // and updating the user's wallet balance in the database.
    console.log(`Adding ${amount} using ${paymentMethod} for user ${req.user.id}`);

    // Simulate a successful transaction
    const newTransaction = {
      userId: req.user.id,
      type: 'DEPOSIT',
      amount: amount,
      status: 'COMPLETED',
      paymentMethod: paymentMethod,
      timestamp: new Date().toISOString(),
    };

    // In a real scenario, you would insert this into your database:
    // await db.insert(transactions).values(newTransaction);

    res.status(200).json({
      success: true,
      message: 'Funds added successfully (simulation).',
      data: newTransaction,
    });
  } catch (error) {
    console.error('Error adding funds:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input data.',
        errors: error.errors,
      });
    }
    res.status(500).json({
      success: false,
      message: 'An internal server error occurred.',
    });
  }
});


export default router;