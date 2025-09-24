
import express from 'express';
import { db } from '../db/config';
import { transactions, users, orders, auditLogs } from '../db/schema';
import { eq, isNull, desc, and, or, ilike, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createTransactionSchema = z.object({
  orderId: z.number().int().positive().optional(),
  recipientId: z.number().int().positive().optional(),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }),
  netAmount: z.string().refine((val) => !val || (!isNaN(Number(val)) && Number(val) >= 0), {
    message: "Net amount must be a non-negative number"
  }).optional(),
  currency: z.string().default('NGN'),
  type: z.enum(['PAYMENT', 'DELIVERY_EARNINGS', 'REFUND', 'ESCROW_RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT']),
  paymentMethod: z.string().min(1),
  paymentGatewayRef: z.string().optional(),
  paystackTransactionId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.any().default({})
});

const updateTransactionSchema = z.object({
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }).optional(),
  netAmount: z.string().refine((val) => !val || (!isNaN(Number(val)) && Number(val) >= 0), {
    message: "Net amount must be a non-negative number"
  }).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']).optional(),
  paymentGatewayRef: z.string().optional(),
  paystackTransactionId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.any().optional()
});

// Helper function to generate transaction reference
function generateTransactionRef(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN_${timestamp}_${random}`;
}

// Helper function to log audit events
async function logAuditEvent(
  userId: number, 
  action: string, 
  entityId: number, 
  details: any = {}
) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'TRANSACTION',
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

// POST /api/transactions - Create a new transaction
router.post('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = createTransactionSchema.parse(req.body);

    // Verify the order exists if orderId is provided
    if (validatedData.orderId) {
      const order = await db
        .select()
        .from(orders)
        .where(and(
          eq(orders.id, validatedData.orderId),
          isNull(orders.deletedAt)
        ))
        .limit(1);

      if (!order.length) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
    }

    // Verify recipient exists if recipientId is provided
    if (validatedData.recipientId) {
      const recipient = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.recipientId),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!recipient.length) {
        return res.status(404).json({
          success: false,
          message: 'Recipient not found'
        });
      }
    }

    // Generate unique transaction reference
    const transactionRef = generateTransactionRef();

    // Create the transaction
    const newTransaction = await db.insert(transactions).values({
      userId: currentUser.id,
      orderId: validatedData.orderId || null,
      recipientId: validatedData.recipientId || null,
      amount: validatedData.amount,
      netAmount: validatedData.netAmount || validatedData.amount,
      currency: validatedData.currency,
      type: validatedData.type,
      paymentMethod: validatedData.paymentMethod,
      paymentGatewayRef: validatedData.paymentGatewayRef || null,
      paystackTransactionId: validatedData.paystackTransactionId || null,
      description: validatedData.description || null,
      metadata: validatedData.metadata,
      transactionRef,
      initiatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'TRANSACTION_CREATED',
      newTransaction[0].id,
      { 
        transactionRef, 
        type: validatedData.type, 
        amount: validatedData.amount,
        paymentMethod: validatedData.paymentMethod
      }
    );

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: newTransaction[0]
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction'
    });
  }
});

// GET /api/transactions - List all transactions
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const type = req.query.type as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(transactions.deletedAt)];

    // Non-admin users can only see their own transactions or those they're involved in
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(transactions.userId, currentUser.id),
          eq(transactions.recipientId, currentUser.id)
        )!
      );
    }

    if (search) {
      conditions.push(
        or(
          ilike(transactions.transactionRef, `%${search}%`),
          ilike(transactions.description, `%${search}%`),
          ilike(transactions.paymentGatewayRef, `%${search}%`)
        )!
      );
    }

    if (status) {
      conditions.push(eq(transactions.status, status as any));
    }

    if (type) {
      conditions.push(eq(transactions.type, type as any));
    }

    if (startDate) {
      conditions.push(gte(transactions.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(transactions.createdAt, new Date(endDate)));
    }

    // Get transactions with user and recipient info
    const transactionsList = await db
      .select({
        transaction: transactions,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        },
        recipient: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        },
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber
        }
      })
      .from(transactions)
      .leftJoin(users, eq(transactions.userId, users.id))
      .leftJoin(orders, eq(transactions.orderId, orders.id))
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCountResult = await db
      .select({ count: transactions.id })
      .from(transactions)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

    const totalCount = totalCountResult.length;

    res.json({
      success: true,
      data: transactionsList,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('List transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve transactions'
    });
  }
});

// GET /api/transactions/:id - Get transaction details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const transactionId = parseInt(req.params.id);

    if (isNaN(transactionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID'
      });
    }

    // Build query conditions
    const conditions = [
      eq(transactions.id, transactionId),
      isNull(transactions.deletedAt)
    ];

    // Non-admin users can only access their own transactions or those they're involved in
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(transactions.userId, currentUser.id),
          eq(transactions.recipientId, currentUser.id)
        )!
      );
    }

    const transaction = await db
      .select({
        transaction: transactions,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        },
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status
        }
      })
      .from(transactions)
      .leftJoin(users, eq(transactions.userId, users.id))
      .leftJoin(orders, eq(transactions.orderId, orders.id))
      .where(and(...conditions))
      .limit(1);

    if (!transaction.length) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      data: transaction[0]
    });
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve transaction'
    });
  }
});

// PUT /api/transactions/:id - Update transaction details
router.put('/:id', requireAuth, requireRole(['ADMIN', 'MERCHANT']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const transactionId = parseInt(req.params.id);
    const validatedData = updateTransactionSchema.parse(req.body);

    if (isNaN(transactionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID'
      });
    }

    // Check if transaction exists and user has permission
    const conditions = [
      eq(transactions.id, transactionId),
      isNull(transactions.deletedAt)
    ];

    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(transactions.userId, currentUser.id));
    }

    const existingTransaction = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .limit(1);

    if (!existingTransaction.length) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found or access denied'
      });
    }

    // Prevent updating completed or refunded transactions
    if (existingTransaction[0].status === 'COMPLETED' || existingTransaction[0].status === 'REFUNDED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update completed or refunded transactions'
      });
    }

    // Update the transaction
    const updatedTransaction = await db
      .update(transactions)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(transactions.id, transactionId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'TRANSACTION_UPDATED',
      transactionId,
      { changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: updatedTransaction[0]
    });
  } catch (error) {
    console.error('Update transaction error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update transaction'
    });
  }
});

// POST /api/transactions/:id/confirm - Confirm a transaction
router.post('/:id/confirm', requireAuth, requireRole(['ADMIN', 'MERCHANT']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const transactionId = parseInt(req.params.id);
    const { paystackTransactionId, paymentGatewayRef } = req.body;

    if (isNaN(transactionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID'
      });
    }

    // Check if transaction exists and user has permission
    const conditions = [
      eq(transactions.id, transactionId),
      isNull(transactions.deletedAt)
    ];

    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(transactions.userId, currentUser.id));
    }

    const existingTransaction = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .limit(1);

    if (!existingTransaction.length) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found or access denied'
      });
    }

    // Check if transaction is in pending status
    if (existingTransaction[0].status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Only pending transactions can be confirmed'
      });
    }

    // Update transaction to completed
    const updatedTransaction = await db
      .update(transactions)
      .set({
        status: 'COMPLETED',
        paystackTransactionId: paystackTransactionId || existingTransaction[0].paystackTransactionId,
        paymentGatewayRef: paymentGatewayRef || existingTransaction[0].paymentGatewayRef,
        completedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(transactions.id, transactionId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'TRANSACTION_CONFIRMED',
      transactionId,
      { 
        previousStatus: existingTransaction[0].status,
        paystackTransactionId,
        paymentGatewayRef
      }
    );

    res.json({
      success: true,
      message: 'Transaction confirmed successfully',
      data: updatedTransaction[0]
    });
  } catch (error) {
    console.error('Confirm transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm transaction'
    });
  }
});

// POST /api/transactions/:id/refund - Refund a transaction
router.post('/:id/refund', requireAuth, requireRole(['ADMIN', 'MERCHANT']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const transactionId = parseInt(req.params.id);
    const { reason, refundAmount } = req.body;

    if (isNaN(transactionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID'
      });
    }

    // Check if transaction exists and user has permission
    const conditions = [
      eq(transactions.id, transactionId),
      isNull(transactions.deletedAt)
    ];

    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(transactions.userId, currentUser.id));
    }

    const existingTransaction = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .limit(1);

    if (!existingTransaction.length) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found or access denied'
      });
    }

    // Check if transaction can be refunded
    if (existingTransaction[0].status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'Only completed transactions can be refunded'
      });
    }

    // Validate refund amount
    const originalAmount = parseFloat(existingTransaction[0].amount);
    const refundAmountNum = refundAmount ? parseFloat(refundAmount) : originalAmount;

    if (refundAmountNum <= 0 || refundAmountNum > originalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Invalid refund amount'
      });
    }

    // Update transaction to refunded
    const updatedTransaction = await db
      .update(transactions)
      .set({
        status: 'REFUNDED',
        metadata: {
          ...existingTransaction[0].metadata,
          refund: {
            reason: reason || 'Refund requested',
            refundAmount: refundAmountNum,
            refundedBy: currentUser.id,
            refundedAt: new Date()
          }
        },
        updatedAt: new Date()
      })
      .where(eq(transactions.id, transactionId))
      .returning();

    // Create a refund transaction record
    const refundRef = generateTransactionRef();
    await db.insert(transactions).values({
      userId: existingTransaction[0].userId,
      recipientId: currentUser.id,
      amount: refundAmountNum.toString(),
      netAmount: refundAmountNum.toString(),
      currency: existingTransaction[0].currency,
      type: 'REFUND',
      status: 'COMPLETED',
      paymentMethod: existingTransaction[0].paymentMethod,
      transactionRef: refundRef,
      description: `Refund for transaction ${existingTransaction[0].transactionRef}`,
      metadata: {
        originalTransactionId: transactionId,
        refundReason: reason || 'Refund requested'
      },
      initiatedAt: new Date(),
      completedAt: new Date()
    });

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'TRANSACTION_REFUNDED',
      transactionId,
      { 
        reason: reason || 'Refund requested',
        refundAmount: refundAmountNum,
        originalAmount
      }
    );

    res.json({
      success: true,
      message: 'Transaction refunded successfully',
      data: updatedTransaction[0]
    });
  } catch (error) {
    console.error('Refund transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refund transaction'
    });
  }
});

export default router;
