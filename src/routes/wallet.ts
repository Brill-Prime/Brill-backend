
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

export default router;
