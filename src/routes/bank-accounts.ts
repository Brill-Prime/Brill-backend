
import express from 'express';
import { db } from '../db/config';
import { users, auditLogs } from '../db/schema';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole } from '../utils/auth';
import PaystackService from '../services/paystack';

const router = express.Router();

// Validation schema
const addBankAccountSchema = z.object({
  bankCode: z.string().min(3),
  accountNumber: z.string().min(10).max(10),
  accountName: z.string().min(1)
});

// GET /api/bank-accounts/banks - Get list of banks
router.get('/banks', requireAuth, async (req, res) => {
  try {
    const banksResult = await PaystackService.getBanks('nigeria');
    
    if (banksResult.success) {
      res.json({
        success: true,
        data: banksResult.data
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch banks'
      });
    }
  } catch (error) {
    console.error('Get banks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banks'
    });
  }
});

// POST /api/bank-accounts/verify - Verify account number
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: 'Account number and bank code are required'
      });
    }

    const verificationResult = await PaystackService.resolveAccountNumber(
      accountNumber,
      bankCode
    );

    if (verificationResult.success) {
      res.json({
        success: true,
        data: {
          accountName: verificationResult.account_name,
          accountNumber: verificationResult.account_number
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: verificationResult.error || 'Account verification failed'
      });
    }
  } catch (error) {
    console.error('Verify account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify account'
    });
  }
});

// POST /api/bank-accounts - Add bank account
router.post('/', requireAuth, requireRole(['MERCHANT', 'DRIVER']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = addBankAccountSchema.parse(req.body);

    // Create Paystack transfer recipient
    const recipientResult = await PaystackService.createTransferRecipient({
      type: 'nuban',
      name: validatedData.accountName,
      account_number: validatedData.accountNumber,
      bank_code: validatedData.bankCode,
      currency: 'NGN',
      description: `${currentUser.role} payout account`
    });

    if (!recipientResult.success) {
      return res.status(400).json({
        success: false,
        message: recipientResult.error || 'Failed to create transfer recipient'
      });
    }

    // Update user with bank account details
    const updatedUser = await db
      .update(users)
      .set({
        paystackRecipientCode: recipientResult.recipient_code,
        accountNumber: validatedData.accountNumber,
        accountName: validatedData.accountName,
        bankName: validatedData.bankCode // Store bank code for now
      })
      .where(eq(users.id, currentUser.id))
      .returning();

    // Log audit event
    await db.insert(auditLogs).values({
      userId: currentUser.id,
      action: 'BANK_ACCOUNT_ADDED',
      entityType: 'USER',
      entityId: currentUser.id,
      details: {
        accountNumber: validatedData.accountNumber,
        bankCode: validatedData.bankCode
      }
    });

    res.json({
      success: true,
      message: 'Bank account added successfully',
      data: {
        accountNumber: updatedUser[0].accountNumber,
        accountName: updatedUser[0].accountName,
        bankName: updatedUser[0].bankName
      }
    });
  } catch (error) {
    console.error('Add bank account error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to add bank account'
    });
  }
});

// GET /api/bank-accounts - Get user's bank account
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    const user = await db
      .select({
        accountNumber: users.accountNumber,
        accountName: users.accountName,
        bankName: users.bankName,
        paystackRecipientCode: users.paystackRecipientCode
      })
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

    res.json({
      success: true,
      data: user[0] || null
    });
  } catch (error) {
    console.error('Get bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bank account'
    });
  }
});

export default router;
