import express from 'express';
import { db } from '../db/config';
import { users } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const addPaymentMethodSchema = z.object({
  type: z.enum(['card', 'bank_account']),
  // For cards
  cardNumber: z.string().optional(),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().optional(),
  cvv: z.string().optional(),
  // For bank accounts
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  bankName: z.string().optional(),
  // Common
  isDefault: z.boolean().optional().default(false)
});

// GET /api/payment-methods - Get user's payment methods
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    // Get user's saved payment methods from user metadata
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Payment methods are stored in user metadata (or you could create a separate table)
    const paymentMethods = (user.metadata as any)?.paymentMethods || [];

    res.json({
      success: true,
      data: paymentMethods
    });
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment methods',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// POST /api/payment-methods - Add payment method
router.post('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = addPaymentMethodSchema.parse(req.body);

    // Get current user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const paymentMethods = (user.metadata as any)?.paymentMethods || [];

    // Create new payment method
    const newPaymentMethod: any = {
      id: `pm_${Date.now()}`,
      type: validatedData.type,
      isDefault: validatedData.isDefault || paymentMethods.length === 0,
      createdAt: new Date().toISOString()
    };

    if (validatedData.type === 'card') {
      if (!validatedData.cardNumber || !validatedData.expiryMonth || !validatedData.expiryYear || !validatedData.cvv) {
        return res.status(400).json({
          success: false,
          message: 'Card details are required: cardNumber, expiryMonth, expiryYear, cvv'
        });
      }

      // Get card brand from first digit
      const firstDigit = validatedData.cardNumber[0];
      const brand = firstDigit === '4' ? 'visa' : firstDigit === '5' ? 'mastercard' : 'other';

      newPaymentMethod.last4 = validatedData.cardNumber.slice(-4);
      newPaymentMethod.brand = brand;
      newPaymentMethod.expiryMonth = validatedData.expiryMonth;
      newPaymentMethod.expiryYear = validatedData.expiryYear;
    } else {
      if (!validatedData.accountNumber || !validatedData.bankName) {
        return res.status(400).json({
          success: false,
          message: 'Bank account details are required: accountNumber, bankName'
        });
      }

      newPaymentMethod.last4 = validatedData.accountNumber.slice(-4);
      newPaymentMethod.accountNumber = validatedData.accountNumber.slice(-4);
      newPaymentMethod.bankName = validatedData.bankName;
      newPaymentMethod.routingNumber = validatedData.routingNumber;
    }

    // If this is set as default, unset others
    if (newPaymentMethod.isDefault) {
      paymentMethods.forEach((pm: any) => pm.isDefault = false);
    }

    paymentMethods.push(newPaymentMethod);

    // Update user metadata
    await db
      .update(users)
      .set({
        metadata: {
          ...(user.metadata as any || {}),
          paymentMethods
        },
        updatedAt: new Date()
      })
      .where(eq(users.id, currentUser.id));

    res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: newPaymentMethod
    });
  } catch (error) {
    console.error('Add payment method error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to add payment method',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// DELETE /api/payment-methods/:id - Remove payment method
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const paymentMethodId = req.params.id;

    // Get current user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let paymentMethods = (user.metadata as any)?.paymentMethods || [];

    // Find payment method
    const methodIndex = paymentMethods.findIndex((pm: any) => pm.id === paymentMethodId);

    if (methodIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    // Remove payment method
    const wasDefault = paymentMethods[methodIndex].isDefault;
    paymentMethods.splice(methodIndex, 1);

    // If removed method was default, set first remaining as default
    if (wasDefault && paymentMethods.length > 0) {
      paymentMethods[0].isDefault = true;
    }

    // Update user metadata
    await db
      .update(users)
      .set({
        metadata: {
          ...(user.metadata as any || {}),
          paymentMethods
        },
        updatedAt: new Date()
      })
      .where(eq(users.id, currentUser.id));

    res.json({
      success: true,
      message: 'Payment method removed'
    });
  } catch (error) {
    console.error('Remove payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove payment method',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

// PUT /api/payment-methods/:id/default - Set default payment method
router.put('/:id/default', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const paymentMethodId = req.params.id;

    // Get current user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let paymentMethods = (user.metadata as any)?.paymentMethods || [];

    // Find payment method
    const method = paymentMethods.find((pm: any) => pm.id === paymentMethodId);

    if (!method) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    // Unset all defaults
    paymentMethods.forEach((pm: any) => pm.isDefault = false);

    // Set new default
    method.isDefault = true;

    // Update user metadata
    await db
      .update(users)
      .set({
        metadata: {
          ...(user.metadata as any || {}),
          paymentMethods
        },
        updatedAt: new Date()
      })
      .where(eq(users.id, currentUser.id));

    res.json({
      success: true,
      message: 'Default payment method updated'
    });
  } catch (error) {
    console.error('Set default payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set default payment method',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;
