import express from 'express';
import { db } from '../db/config';
import { escrows, orders, users, auditLogs, transactions } from '../db/schema';
import { eq, isNull, desc, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createEscrowSchema = z.object({
  orderId: z.number().int().positive(),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }),
  paystackReference: z.string().optional(),
  merchantAmount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Merchant amount must be a positive number"
  }),
  driverAmount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Driver amount must be a positive number"
  })
});

const confirmDeliverySchema = z.object({
  orderId: z.number().int().positive()
});

const disputeEscrowSchema = z.object({
  escrowId: z.number().int().positive(),
  reason: z.string().min(10),
  disputedBy: z.enum(['CONSUMER', 'DRIVER'])
});

// Helper function to log audit events
const logAuditEvent = async (userId: number, action: string, entityId: number, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'ESCROW',
      entityId,
      details,
      ipAddress: '',
      userAgent: ''
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

// POST /api/escrows - Create escrow (called during order creation)
router.post('/', requireAuth, async (req, res) => {
  try {
    const validatedData = createEscrowSchema.parse(req.body);
    const currentUser = req.user!;

    // Validate order exists
    const orderExists = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, validatedData.orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!orderExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = orderExists[0];

    // Verify user is the customer
    if (currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the order customer can create escrow'
      });
    }

    // Check if escrow already exists
    const existingEscrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.orderId, validatedData.orderId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (existingEscrow.length) {
      return res.status(400).json({
        success: false,
        message: 'Escrow already exists for this order'
      });
    }

    // Create escrow with merchant and driver split
    const newEscrow = await db.insert(escrows).values({
      orderId: validatedData.orderId,
      payerId: order.customerId,
      payeeId: order.merchantId!, // Merchant receives payment
      amount: validatedData.amount,
      status: 'HELD',
      paystackEscrowId: validatedData.paystackReference || null,
      transactionRef: validatedData.paystackReference || `ESC_${Date.now()}_${validatedData.orderId}`,
      createdAt: new Date()
    }).returning();

    // Store split amounts in metadata
    await db.insert(transactions).values({
      userId: order.customerId,
      orderId: validatedData.orderId,
      amount: validatedData.amount,
      currency: 'NGN',
      type: 'PAYMENT',
      status: 'PENDING',
      transactionRef: newEscrow[0].transactionRef!,
      description: `Escrow payment for order ${order.orderNumber}`,
      metadata: {
        merchantAmount: validatedData.merchantAmount,
        driverAmount: validatedData.driverAmount,
        escrowId: newEscrow[0].id
      },
      initiatedAt: new Date(),
      createdAt: new Date()
    });

    await logAuditEvent(
      currentUser.id,
      'ESCROW_CREATED',
      newEscrow[0].id,
      { orderId: validatedData.orderId, amount: validatedData.amount }
    );

    res.status(201).json({
      success: true,
      message: 'Escrow created and payment held',
      data: newEscrow[0]
    });
  } catch (error) {
    console.error('Create escrow error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create escrow'
    });
  }
});

// POST /api/escrows/delivery/complete - Driver marks delivery complete
router.post('/delivery/complete', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const { orderId } = confirmDeliverySchema.parse(req.body);
    const currentUser = req.user!;

    const order = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify driver is assigned to this order
    if (order[0].driverId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'Only assigned driver can mark delivery complete'
      });
    }

    // Update order status
    await db
      .update(orders)
      .set({
        status: 'DELIVERED',
        deliveredAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));

    await logAuditEvent(
      currentUser.id,
      'DELIVERY_COMPLETED',
      orderId,
      { driverId: currentUser.id }
    );

    res.json({
      success: true,
      message: 'Delivery marked as complete. Awaiting consumer confirmation.'
    });
  } catch (error) {
    console.error('Complete delivery error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to mark delivery complete'
    });
  }
});

// POST /api/escrows/delivery/confirm - Consumer confirms receipt
router.post('/delivery/confirm', requireAuth, async (req, res) => {
  try {
    const { orderId } = confirmDeliverySchema.parse(req.body);
    const currentUser = req.user!;

    const order = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify user is the customer
    if (order[0].customerId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer can confirm delivery'
      });
    }

    // Verify delivery was marked complete
    if (order[0].status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Delivery must be marked complete by driver first'
      });
    }

    await logAuditEvent(
      currentUser.id,
      'DELIVERY_CONFIRMED',
      orderId,
      { customerId: currentUser.id }
    );

    // Trigger automatic escrow release
    const releaseResult = await releaseEscrowFunds(orderId, currentUser.id);

    if (!releaseResult.success) {
      return res.status(500).json({
        success: false,
        message: releaseResult.message || 'Failed to release escrow funds'
      });
    }

    res.json({
      success: true,
      message: 'Delivery confirmed. Payments released to merchant and driver.',
      data: releaseResult.data
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to confirm delivery'
    });
  }
});

// POST /api/escrows/dispute - Raise dispute
router.post('/dispute', requireAuth, async (req, res) => {
  try {
    const validatedData = disputeEscrowSchema.parse(req.body);
    const currentUser = req.user!;

    const escrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.id, validatedData.escrowId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!escrow.length) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    // Get order details
    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.id, escrow[0].orderId))
      .limit(1);

    if (!order.length) {
      return res.status(404).json({
        success: false,
        message: 'Associated order not found'
      });
    }

    // Verify user is involved (consumer or driver)
    const isConsumer = order[0].customerId === currentUser.id;
    const isDriver = order[0].driverId === currentUser.id;

    if (!isConsumer && !isDriver) {
      return res.status(403).json({
        success: false,
        message: 'Only consumer or driver can raise dispute'
      });
    }

    // Check escrow is not already released
    if (escrow[0].status === 'RELEASED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot dispute an already released escrow'
      });
    }

    // Update escrow to disputed
    const updatedEscrow = await db
      .update(escrows)
      .set({
        status: 'DISPUTED'
      })
      .where(eq(escrows.id, validatedData.escrowId))
      .returning();

    // Create audit log with dispute details
    await logAuditEvent(
      currentUser.id,
      'ESCROW_DISPUTED',
      validatedData.escrowId,
      { 
        reason: validatedData.reason,
        disputedBy: validatedData.disputedBy,
        disputedByRole: isConsumer ? 'CONSUMER' : 'DRIVER',
        orderId: escrow[0].orderId,
        orderNumber: order[0].orderNumber,
        escrowAmount: escrow[0].amount
      }
    );

    res.json({
      success: true,
      message: 'Dispute raised successfully. Payment will remain in escrow until admin resolves the case.',
      data: updatedEscrow[0]
    });
  } catch (error) {
    console.error('Dispute escrow error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to raise dispute'
    });
  }
});

// POST /api/escrows/:id/release - Admin manual release
router.post('/:id/release', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const escrowId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { merchantAmount, driverAmount } = req.body;

    if (isNaN(escrowId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid escrow ID'
      });
    }

    const escrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.id, escrowId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!escrow.length) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    const releaseResult = await releaseEscrowFunds(escrow[0].orderId, currentUser.id, true, merchantAmount, driverAmount);

    if (!releaseResult.success) {
      return res.status(500).json({
        success: false,
        message: releaseResult.message || 'Failed to release escrow funds'
      });
    }

    res.json({
      success: true,
      message: 'Escrow released by admin',
      data: releaseResult.data
    });
  } catch (error) {
    console.error('Admin release error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release escrow'
    });
  }
});

// GET /api/escrows - List escrows
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    const offset = (page - 1) * limit;
    const conditions = [isNull(escrows.deletedAt)];

    // Non-admin users see their own escrows
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(escrows.payerId, currentUser.id),
          eq(escrows.payeeId, currentUser.id)
        )!
      );
    }

    if (status) {
      conditions.push(eq(escrows.status, status as any));
    }

    const allEscrows = await db
      .select()
      .from(escrows)
      .where(and(...conditions))
      .orderBy(desc(escrows.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: allEscrows,
      pagination: {
        currentPage: page,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get escrows error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch escrows'
    });
  }
});

// Helper function to release escrow funds
async function releaseEscrowFunds(orderId: number, releasedBy: number, isAdmin: boolean = false, merchantAmountOverride?: string, driverAmountOverride?: string) {
  try {
    const escrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.orderId, orderId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!escrow.length) {
      return { success: false, message: 'Escrow not found' };
    }

    if (escrow[0].status === 'RELEASED') {
      return { success: false, message: 'Escrow already released' };
    }

    // Get transaction metadata for split amounts
    const transaction = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, escrow[0].transactionRef!))
      .limit(1);

    if (!transaction.length) {
      return { success: false, message: 'Transaction not found' };
    }

    const metadata = transaction[0].metadata as any || {};
    const merchantAmount = merchantAmountOverride || metadata.merchantAmount || '0';
    const driverAmount = driverAmountOverride || metadata.driverAmount || '0';

    // Get order
    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order.length) {
      return { success: false, message: 'Order not found' };
    }

    // Get merchant details for payout
    const merchant = await db
      .select()
      .from(users)
      .where(eq(users.id, order[0].merchantId!))
      .limit(1);

    // Get driver details for payout
    const driver = await db
      .select()
      .from(users)
      .where(eq(users.id, order[0].driverId!))
      .limit(1);

    // Initiate Paystack transfer to merchant if they have bank account
    let merchantTransferStatus = 'PENDING';
    if (merchant[0]?.paystackRecipientCode) {
      try {
        const PaystackService = (await import('../services/paystack')).default;
        const transferResult = await PaystackService.initiateTransfer({
          source: 'balance',
          amount: parseFloat(merchantAmount) * 100, // Convert to kobo
          recipient: merchant[0].paystackRecipientCode,
          reason: `Payment for order ${order[0].orderNumber}`,
          reference: `MERCHANT_${escrow[0].transactionRef}`
        });

        if (transferResult.status) {
          merchantTransferStatus = 'COMPLETED';
        }
      } catch (error) {
        console.error('Merchant transfer failed:', error);
        merchantTransferStatus = 'FAILED';
      }
    }

    // Initiate Paystack transfer to driver if they have bank account
    let driverTransferStatus = 'PENDING';
    if (driver[0]?.paystackRecipientCode) {
      try {
        const PaystackService = (await import('../services/paystack')).default;
        const transferResult = await PaystackService.initiateTransfer({
          source: 'balance',
          amount: parseFloat(driverAmount) * 100, // Convert to kobo
          recipient: driver[0].paystackRecipientCode,
          reason: `Delivery fee for order ${order[0].orderNumber}`,
          reference: `DRIVER_${escrow[0].transactionRef}`
        });

        if (transferResult.status) {
          driverTransferStatus = 'COMPLETED';
        }
      } catch (error) {
        console.error('Driver transfer failed:', error);
        driverTransferStatus = 'FAILED';
      }
    }

    // Record merchant transaction
    await db.insert(transactions).values({
      userId: order[0].merchantId!,
      orderId,
      amount: merchantAmount,
      netAmount: merchantAmount,
      currency: 'NGN',
      type: 'ESCROW_RELEASE',
      status: merchantTransferStatus as any,
      transactionRef: `MERCHANT_${escrow[0].transactionRef}`,
      description: `Payment for order ${order[0].orderNumber}`,
      completedAt: merchantTransferStatus === 'COMPLETED' ? new Date() : null,
      createdAt: new Date()
    });

    // Record driver transaction
    await db.insert(transactions).values({
      userId: order[0].driverId!,
      orderId,
      amount: driverAmount,
      netAmount: driverAmount,
      currency: 'NGN',
      type: 'ESCROW_RELEASE',
      status: driverTransferStatus as any,
      transactionRef: `DRIVER_${escrow[0].transactionRef}`,
      description: `Delivery fee for order ${order[0].orderNumber}`,
      completedAt: driverTransferStatus === 'COMPLETED' ? new Date() : null,
      createdAt: new Date()
    });

    // Update escrow status
    const updatedEscrow = await db
      .update(escrows)
      .set({
        status: 'RELEASED',
        releasedAt: new Date()
      })
      .where(eq(escrows.id, escrow[0].id))
      .returning();

    // Update original transaction
    await db
      .update(transactions)
      .set({
        status: 'COMPLETED',
        completedAt: new Date()
      })
      .where(eq(transactions.id, transaction[0].id));

    await logAuditEvent(
      releasedBy,
      'ESCROW_RELEASED',
      escrow[0].id,
      { 
        orderId,
        merchantAmount,
        driverAmount,
        isAdmin
      }
    );

    return { 
      success: true, 
      data: {
        escrow: updatedEscrow[0],
        merchantAmount,
        driverAmount
      }
    };
  } catch (error) {
    console.error('Release escrow error:', error);
    return { success: false, message: 'Failed to release funds' };
  }
}

export default router;