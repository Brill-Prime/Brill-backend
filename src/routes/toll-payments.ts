import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { transactions, users, auditLogs, tollGates } from '../db/schema';
import { eq, and, desc, isNull, count } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createTollPaymentSchema = z.object({
  tollGateId: z.number().int().positive(),
  vehicleType: z.enum(['motorcycle', 'car', 'suv', 'truck']),
  amount: z.number().positive(),
  vehiclePlate: z.string().optional(),
  paymentMethod: z.enum(['CARD', 'CASH', 'WALLET']).default('CARD')
});

// POST /api/toll-payments - Create toll payment
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = createTollPaymentSchema.parse(req.body);

    // Verify toll gate exists
    const [tollGate] = await db
      .select()
      .from(tollGates)
      .where(and(
        eq(tollGates.id, validatedData.tollGateId),
        isNull(tollGates.deletedAt)
      ))
      .limit(1);

    if (!tollGate) {
      return res.status(404).json({
        success: false,
        message: 'Toll gate not found'
      });
    }

    // Create transaction for toll payment
    const transactionRef = `TOLL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    
    const [transaction] = await db
      .insert(transactions)
      .values({
        userId,
        amount: validatedData.amount.toString(),
        currency: 'NGN',
        type: 'TOLL_PAYMENT',
        status: 'COMPLETED',
        paymentMethod: validatedData.paymentMethod,
        transactionRef,
        metadata: {
          tollGateId: validatedData.tollGateId,
          tollGateName: tollGate.name,
          vehicleType: validatedData.vehicleType,
          vehiclePlate: validatedData.vehiclePlate,
          location: tollGate.location
        }
      })
      .returning();

    // Log audit
    await db.insert(auditLogs).values({
      userId,
      action: 'TOLL_PAYMENT_CREATED',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      details: {
        tollGateId: validatedData.tollGateId,
        amount: validatedData.amount,
        vehicleType: validatedData.vehicleType
      }
    });

    res.status(201).json({
      success: true,
      message: 'Toll payment created successfully',
      data: {
        transactionId: transaction.id,
        transactionRef,
        tollGate: {
          id: tollGate.id,
          name: tollGate.name,
          location: tollGate.location
        },
        amount: transaction.amount,
        vehicleType: validatedData.vehicleType,
        paymentMethod: validatedData.paymentMethod,
        paidAt: transaction.createdAt
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    console.error('Create toll payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create toll payment'
    });
  }
});

// GET /api/toll-payments - Get user's toll payments
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    // Get toll payments for user
    const tollPayments = await db
      .select({
        id: transactions.id,
        transactionRef: transactions.transactionRef,
        amount: transactions.amount,
        currency: transactions.currency,
        status: transactions.status,
        paymentMethod: transactions.paymentMethod,
        metadata: transactions.metadata,
        createdAt: transactions.createdAt
      })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'TOLL_PAYMENT')
      ))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [countResult] = await db
      .select({ count: count() })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        eq(transactions.type, 'TOLL_PAYMENT')
      ));

    const totalCount = Number(countResult?.count) || 0;

    res.json({
      success: true,
      data: tollPayments.map(payment => ({
        id: payment.id,
        transactionRef: payment.transactionRef,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        tollGate: {
          id: (payment.metadata as any)?.tollGateId,
          name: (payment.metadata as any)?.tollGateName,
          location: (payment.metadata as any)?.location
        },
        vehicleType: (payment.metadata as any)?.vehicleType,
        vehiclePlate: (payment.metadata as any)?.vehiclePlate,
        paidAt: payment.createdAt
      })),
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(Number(totalCount) / limit),
        totalItems: totalCount
      }
    });
  } catch (error) {
    console.error('Get toll payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve toll payments'
    });
  }
});

export default router;
