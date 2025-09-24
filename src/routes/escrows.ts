
import express from 'express';
import { db } from '../db/config';
import { escrows, orders, users, auditLogs, transactions } from '../db/schema';
import { eq, isNull, desc, and, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createEscrowSchema = z.object({
  orderId: z.number().int().positive(),
  payerId: z.number().int().positive(),
  payeeId: z.number().int().positive(),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }),
  paystackEscrowId: z.string().optional(),
  transactionRef: z.string().optional()
});

const updateEscrowSchema = z.object({
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number"
  }).optional(),
  status: z.enum(['HELD', 'RELEASED', 'REFUNDED', 'DISPUTED']).optional(),
  paystackEscrowId: z.string().optional(),
  transactionRef: z.string().optional()
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

// POST /api/escrows - Create a new escrow
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

    // Validate payer exists
    const payerExists = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, validatedData.payerId),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!payerExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Payer not found'
      });
    }

    // Validate payee exists
    const payeeExists = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, validatedData.payeeId),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!payeeExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Payee not found'
      });
    }

    // Check if user has permission to create escrow
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== validatedData.payerId && 
        currentUser.id !== orderExists[0].customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only admin, payer, or order customer can create escrow'
      });
    }

    // Check if escrow already exists for this order
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

    const newEscrow = await db.insert(escrows).values({
      orderId: validatedData.orderId,
      payerId: validatedData.payerId,
      payeeId: validatedData.payeeId,
      amount: validatedData.amount,
      status: 'HELD',
      paystackEscrowId: validatedData.paystackEscrowId || null,
      transactionRef: validatedData.transactionRef || null,
      createdAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ESCROW_CREATED',
      newEscrow[0].id,
      { orderId: validatedData.orderId, amount: validatedData.amount }
    );

    res.status(201).json({
      success: true,
      message: 'Escrow created successfully',
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

// GET /api/escrows - List all escrows
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const orderId = req.query.orderId as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(escrows.deletedAt)];

    // Non-admin users can only see their own escrows
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(escrows.payerId, currentUser.id),
          eq(escrows.payeeId, currentUser.id)
        )!
      );
    }

    if (search) {
      conditions.push(ilike(escrows.transactionRef, `%${search}%`));
    }

    if (status) {
      conditions.push(eq(escrows.status, status as any));
    }

    if (orderId) {
      conditions.push(eq(escrows.orderId, parseInt(orderId)));
    }

    const allEscrows = await db
      .select({
        id: escrows.id,
        orderId: escrows.orderId,
        orderNumber: orders.orderNumber,
        payerId: escrows.payerId,
        payerName: users.fullName,
        payeeId: escrows.payeeId,
        amount: escrows.amount,
        status: escrows.status,
        paystackEscrowId: escrows.paystackEscrowId,
        transactionRef: escrows.transactionRef,
        createdAt: escrows.createdAt,
        releasedAt: escrows.releasedAt,
        cancelledAt: escrows.cancelledAt
      })
      .from(escrows)
      .leftJoin(orders, eq(escrows.orderId, orders.id))
      .leftJoin(users, eq(escrows.payerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(escrows.createdAt))
      .limit(limit)
      .offset(offset);

    // Get payee names
    const escrowsWithPayeeNames = await Promise.all(
      allEscrows.map(async (escrow) => {
        const payee = await db
          .select({ fullName: users.fullName })
          .from(users)
          .where(eq(users.id, escrow.payeeId))
          .limit(1);
        
        return {
          ...escrow,
          payeeName: payee[0]?.fullName || 'Unknown'
        };
      })
    );

    // Get total count for pagination
    const totalCount = await db
      .select({ count: escrows.id })
      .from(escrows)
      .where(and(...conditions));

    res.json({
      success: true,
      data: escrowsWithPayeeNames,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.length / limit),
        totalItems: totalCount.length,
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

// GET /api/escrows/:id - Get escrow details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const escrowId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(escrowId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid escrow ID'
      });
    }

    const escrowDetails = await db
      .select({
        id: escrows.id,
        orderId: escrows.orderId,
        orderNumber: orders.orderNumber,
        payerId: escrows.payerId,
        payerName: users.fullName,
        payerEmail: users.email,
        payeeId: escrows.payeeId,
        amount: escrows.amount,
        status: escrows.status,
        paystackEscrowId: escrows.paystackEscrowId,
        transactionRef: escrows.transactionRef,
        createdAt: escrows.createdAt,
        releasedAt: escrows.releasedAt,
        cancelledAt: escrows.cancelledAt
      })
      .from(escrows)
      .leftJoin(orders, eq(escrows.orderId, orders.id))
      .leftJoin(users, eq(escrows.payerId, users.id))
      .where(and(
        eq(escrows.id, escrowId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!escrowDetails.length) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    const escrow = escrowDetails[0];

    // Check access permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== escrow.payerId && 
        currentUser.id !== escrow.payeeId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get payee details
    const payee = await db
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, escrow.payeeId))
      .limit(1);

    const escrowWithPayee = {
      ...escrow,
      payeeName: payee[0]?.fullName || 'Unknown',
      payeeEmail: payee[0]?.email || 'Unknown'
    };

    res.json({
      success: true,
      data: escrowWithPayee
    });
  } catch (error) {
    console.error('Get escrow error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch escrow'
    });
  }
});

// PUT /api/escrows/:id - Update escrow details
router.put('/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const escrowId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(escrowId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid escrow ID'
      });
    }

    const validatedData = updateEscrowSchema.parse(req.body);

    // Check if escrow exists
    const existingEscrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.id, escrowId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!existingEscrow.length) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    const escrow = existingEscrow[0];

    // Prevent updating released or refunded escrows
    if (escrow.status === 'RELEASED' || escrow.status === 'REFUNDED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update released or refunded escrow'
      });
    }

    const updatedEscrow = await db
      .update(escrows)
      .set(validatedData)
      .where(eq(escrows.id, escrowId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ESCROW_UPDATED',
      escrowId,
      { changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Escrow updated successfully',
      data: updatedEscrow[0]
    });
  } catch (error) {
    console.error('Update escrow error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update escrow'
    });
  }
});

// POST /api/escrows/:id/release - Release escrow funds
router.post('/:id/release', requireAuth, requireRole(['ADMIN', 'CONSUMER']), async (req, res) => {
  try {
    const escrowId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason } = req.body;
    
    if (isNaN(escrowId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid escrow ID'
      });
    }

    // Check if escrow exists
    const existingEscrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.id, escrowId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!existingEscrow.length) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    const escrow = existingEscrow[0];

    // Check if escrow can be released
    if (escrow.status !== 'HELD') {
      return res.status(400).json({
        success: false,
        message: 'Only held escrows can be released'
      });
    }

    // Check permissions (only admin or payer can release)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== escrow.payerId) {
      return res.status(403).json({
        success: false,
        message: 'Only admin or payer can release escrow'
      });
    }

    // Get order details for validation
    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.id, escrow.orderId))
      .limit(1);

    if (!order.length) {
      return res.status(404).json({
        success: false,
        message: 'Associated order not found'
      });
    }

    // Only release if order is delivered or admin override
    if (currentUser.role !== 'ADMIN' && order[0].status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Escrow can only be released after order delivery'
      });
    }

    // Release the escrow
    const updatedEscrow = await db
      .update(escrows)
      .set({
        status: 'RELEASED',
        releasedAt: new Date()
      })
      .where(eq(escrows.id, escrowId))
      .returning();

    // Create a transaction record for the release
    await db.insert(transactions).values({
      userId: escrow.payeeId,
      orderId: escrow.orderId,
      recipientId: escrow.payeeId,
      amount: escrow.amount,
      netAmount: escrow.amount,
      currency: 'NGN',
      type: 'ESCROW_RELEASE',
      status: 'COMPLETED',
      transactionRef: escrow.transactionRef || `ESC_REL_${escrowId}_${Date.now()}`,
      description: `Escrow release for order ${order[0].orderNumber}`,
      completedAt: new Date(),
      createdAt: new Date()
    });

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ESCROW_RELEASED',
      escrowId,
      { orderId: escrow.orderId, amount: escrow.amount, reason }
    );

    res.json({
      success: true,
      message: 'Escrow released successfully',
      data: updatedEscrow[0]
    });
  } catch (error) {
    console.error('Release escrow error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release escrow'
    });
  }
});

// POST /api/escrows/:id/refund - Refund escrow funds
router.post('/:id/refund', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const escrowId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason } = req.body;
    
    if (isNaN(escrowId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid escrow ID'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Refund reason is required'
      });
    }

    // Check if escrow exists
    const existingEscrow = await db
      .select()
      .from(escrows)
      .where(and(
        eq(escrows.id, escrowId),
        isNull(escrows.deletedAt)
      ))
      .limit(1);

    if (!existingEscrow.length) {
      return res.status(404).json({
        success: false,
        message: 'Escrow not found'
      });
    }

    const escrow = existingEscrow[0];

    // Check if escrow can be refunded
    if (escrow.status !== 'HELD' && escrow.status !== 'DISPUTED') {
      return res.status(400).json({
        success: false,
        message: 'Only held or disputed escrows can be refunded'
      });
    }

    // Get order details
    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.id, escrow.orderId))
      .limit(1);

    if (!order.length) {
      return res.status(404).json({
        success: false,
        message: 'Associated order not found'
      });
    }

    // Refund the escrow
    const updatedEscrow = await db
      .update(escrows)
      .set({
        status: 'REFUNDED',
        cancelledAt: new Date()
      })
      .where(eq(escrows.id, escrowId))
      .returning();

    // Create a transaction record for the refund
    await db.insert(transactions).values({
      userId: escrow.payerId,
      orderId: escrow.orderId,
      recipientId: escrow.payerId,
      amount: escrow.amount,
      netAmount: escrow.amount,
      currency: 'NGN',
      type: 'REFUND',
      status: 'COMPLETED',
      transactionRef: escrow.transactionRef || `ESC_REF_${escrowId}_${Date.now()}`,
      description: `Escrow refund for order ${order[0].orderNumber}: ${reason}`,
      completedAt: new Date(),
      createdAt: new Date()
    });

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ESCROW_REFUNDED',
      escrowId,
      { orderId: escrow.orderId, amount: escrow.amount, reason }
    );

    res.json({
      success: true,
      message: 'Escrow refunded successfully',
      data: updatedEscrow[0]
    });
  } catch (error) {
    console.error('Refund escrow error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refund escrow'
    });
  }
});

export default router;
