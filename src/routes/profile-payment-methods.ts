import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { users, auditLogs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

const paymentMethodSchema = z.object({
  type: z.enum(['CARD', 'BANK_ACCOUNT', 'WALLET']),
  cardNumber: z.string().optional(),
  cardHolderName: z.string().optional(),
  expiryMonth: z.string().optional(),
  expiryYear: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  isDefault: z.boolean().default(false)
});

// GET /api/profile/payment-methods - Get user's payment methods
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const paymentMethods = (user?.metadata as any)?.paymentMethods || [];

    // Mask sensitive data
    const maskedMethods = paymentMethods.map((method: any) => ({
      ...method,
      cardNumber: method.cardNumber ? `****${method.cardNumber.slice(-4)}` : undefined,
      accountNumber: method.accountNumber ? `****${method.accountNumber.slice(-4)}` : undefined
    }));

    res.json({
      success: true,
      data: maskedMethods
    });
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ success: false, message: 'Failed to get payment methods' });
  }
});

// POST /api/profile/payment-methods - Add payment method
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = paymentMethodSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let paymentMethods = (user?.metadata as any)?.paymentMethods || [];

    if (validatedData.isDefault) {
      paymentMethods = paymentMethods.map((pm: any) => ({ ...pm, isDefault: false }));
    }

    const newPaymentMethod = {
      id: Date.now(),
      ...validatedData,
      createdAt: new Date().toISOString()
    };

    paymentMethods.push(newPaymentMethod);

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), paymentMethods },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'PAYMENT_METHOD_ADDED',
      entityType: 'USER',
      entityId: userId,
      details: { type: validatedData.type }
    });

    res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: { ...newPaymentMethod, cardNumber: undefined, accountNumber: undefined }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    console.error('Add payment method error:', error);
    res.status(500).json({ success: false, message: 'Failed to add payment method' });
  }
});

// PUT /api/profile/payment-methods/:id - Update payment method
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const methodId = parseInt(req.params.id);
    const validatedData = paymentMethodSchema.partial().parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let paymentMethods = (user?.metadata as any)?.paymentMethods || [];
    const methodIndex = paymentMethods.findIndex((pm: any) => pm.id === methodId);

    if (methodIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    if (validatedData.isDefault) {
      paymentMethods = paymentMethods.map((pm: any) => ({ ...pm, isDefault: false }));
    }

    paymentMethods[methodIndex] = {
      ...paymentMethods[methodIndex],
      ...validatedData,
      updatedAt: new Date().toISOString()
    };

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), paymentMethods },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'PAYMENT_METHOD_UPDATED',
      entityType: 'USER',
      entityId: userId,
      details: { methodId }
    });

    res.json({
      success: true,
      message: 'Payment method updated successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    console.error('Update payment method error:', error);
    res.status(500).json({ success: false, message: 'Failed to update payment method' });
  }
});

// DELETE /api/profile/payment-methods/:id - Delete payment method
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const methodId = parseInt(req.params.id);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let paymentMethods = (user?.metadata as any)?.paymentMethods || [];
    paymentMethods = paymentMethods.filter((pm: any) => pm.id !== methodId);

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), paymentMethods },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'PAYMENT_METHOD_DELETED',
      entityType: 'USER',
      entityId: userId,
      details: { methodId }
    });

    res.json({
      success: true,
      message: 'Payment method deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete payment method' });
  }
});

export default router;