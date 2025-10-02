
import express from 'express';
import { db } from '../db/config';
import { fuelOrders, users, auditLogs } from '../db/schema';
import { eq, isNull, desc, and, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createFuelOrderSchema = z.object({
  stationId: z.string().min(1),
  fuelType: z.enum(['PMS', 'AGO', 'DPK']),
  quantity: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Quantity must be a positive number"
  }),
  unitPrice: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Unit price must be a positive number"
  }),
  totalAmount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Total amount must be a positive number"
  }),
  deliveryAddress: z.string().min(1),
  deliveryLatitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery latitude must be a valid number"
  }),
  deliveryLongitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery longitude must be a valid number"
  }),
  scheduledDeliveryTime: z.string().optional(),
  notes: z.string().optional(),
  driverId: z.number().int().positive().optional()
});

const updateFuelOrderSchema = z.object({
  stationId: z.string().min(1).optional(),
  fuelType: z.enum(['PMS', 'AGO', 'DPK']).optional(),
  quantity: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Quantity must be a positive number"
  }).optional(),
  unitPrice: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Unit price must be a positive number"
  }).optional(),
  totalAmount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Total amount must be a positive number"
  }).optional(),
  deliveryAddress: z.string().min(1).optional(),
  deliveryLatitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery latitude must be a valid number"
  }),
  deliveryLongitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery longitude must be a valid number"
  }),
  scheduledDeliveryTime: z.string().optional(),
  notes: z.string().optional(),
  driverId: z.number().int().positive().optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional()
});

// Helper function to log audit events
const logAuditEvent = async (userId: number, action: string, entityId: number, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'FUEL_ORDER',
      entityId,
      details,
      ipAddress: '',
      userAgent: ''
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

// POST /api/fuel-orders - Create a new fuel order
router.post('/', requireAuth, async (req, res) => {
  try {
    const validatedData = createFuelOrderSchema.parse(req.body);
    const currentUser = req.user!;

    // Validate driver if specified
    if (validatedData.driverId) {
      const driver = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.driverId),
          eq(users.role, 'DRIVER'),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!driver.length) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found'
        });
      }
    }

    // Set confirmation deadline (48 hours from now)
    const confirmationDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const newFuelOrder = await db.insert(fuelOrders).values({
      customerId: currentUser.id,
      driverId: validatedData.driverId || null,
      stationId: validatedData.stationId,
      fuelType: validatedData.fuelType,
      quantity: validatedData.quantity,
      unitPrice: validatedData.unitPrice,
      totalAmount: validatedData.totalAmount,
      deliveryAddress: validatedData.deliveryAddress,
      deliveryLatitude: validatedData.deliveryLatitude || null,
      deliveryLongitude: validatedData.deliveryLongitude || null,
      scheduledDeliveryTime: validatedData.scheduledDeliveryTime || null,
      notes: validatedData.notes || null,
      confirmationDeadline,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'FUEL_ORDER_CREATED',
      newFuelOrder[0].id,
      { 
        stationId: validatedData.stationId, 
        fuelType: validatedData.fuelType,
        quantity: validatedData.quantity,
        totalAmount: validatedData.totalAmount
      }
    );

    res.status(201).json({
      success: true,
      message: 'Fuel order created successfully',
      data: newFuelOrder[0]
    });
  } catch (error) {
    console.error('Create fuel order error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create fuel order'
    });
  }
});

// GET /api/fuel-orders - List all fuel orders
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const fuelType = req.query.fuelType as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(fuelOrders.deletedAt)];

    // Non-admin users can only see their own fuel orders or ones assigned to them
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(fuelOrders.customerId, currentUser.id),
          eq(fuelOrders.driverId, currentUser.id)
        )!
      );
    }

    if (search) {
      conditions.push(ilike(fuelOrders.stationId, `%${search}%`));
    }

    if (status) {
      conditions.push(eq(fuelOrders.status, status as any));
    }

    if (fuelType) {
      conditions.push(eq(fuelOrders.fuelType, fuelType as any));
    }

    const allFuelOrders = await db
      .select({
        id: fuelOrders.id,
        customerId: fuelOrders.customerId,
        customerName: users.fullName,
        driverId: fuelOrders.driverId,
        stationId: fuelOrders.stationId,
        fuelType: fuelOrders.fuelType,
        quantity: fuelOrders.quantity,
        unitPrice: fuelOrders.unitPrice,
        totalAmount: fuelOrders.totalAmount,
        deliveryAddress: fuelOrders.deliveryAddress,
        deliveryLatitude: fuelOrders.deliveryLatitude,
        deliveryLongitude: fuelOrders.deliveryLongitude,
        status: fuelOrders.status,
        scheduledDeliveryTime: fuelOrders.scheduledDeliveryTime,
        estimatedDeliveryTime: fuelOrders.estimatedDeliveryTime,
        notes: fuelOrders.notes,
        acceptedAt: fuelOrders.acceptedAt,
        pickedUpAt: fuelOrders.pickedUpAt,
        deliveredAt: fuelOrders.deliveredAt,
        confirmationDeadline: fuelOrders.confirmationDeadline,
        createdAt: fuelOrders.createdAt,
        updatedAt: fuelOrders.updatedAt
      })
      .from(fuelOrders)
      .leftJoin(users, eq(fuelOrders.customerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(fuelOrders.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: fuelOrders.id })
      .from(fuelOrders)
      .where(and(...conditions));

    res.json({
      success: true,
      data: allFuelOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.length / limit),
        totalItems: totalCount.length,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get fuel orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fuel orders'
    });
  }
});

// GET /api/fuel-orders/:id - Get fuel order details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const fuelOrderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(fuelOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fuel order ID'
      });
    }

    const fuelOrderDetails = await db
      .select({
        id: fuelOrders.id,
        customerId: fuelOrders.customerId,
        customerName: users.fullName,
        customerEmail: users.email,
        driverId: fuelOrders.driverId,
        stationId: fuelOrders.stationId,
        fuelType: fuelOrders.fuelType,
        quantity: fuelOrders.quantity,
        unitPrice: fuelOrders.unitPrice,
        totalAmount: fuelOrders.totalAmount,
        deliveryAddress: fuelOrders.deliveryAddress,
        deliveryLatitude: fuelOrders.deliveryLatitude,
        deliveryLongitude: fuelOrders.deliveryLongitude,
        status: fuelOrders.status,
        scheduledDeliveryTime: fuelOrders.scheduledDeliveryTime,
        estimatedDeliveryTime: fuelOrders.estimatedDeliveryTime,
        notes: fuelOrders.notes,
        acceptedAt: fuelOrders.acceptedAt,
        pickedUpAt: fuelOrders.pickedUpAt,
        deliveredAt: fuelOrders.deliveredAt,
        confirmationDeadline: fuelOrders.confirmationDeadline,
        createdAt: fuelOrders.createdAt,
        updatedAt: fuelOrders.updatedAt
      })
      .from(fuelOrders)
      .leftJoin(users, eq(fuelOrders.customerId, users.id))
      .where(and(
        eq(fuelOrders.id, fuelOrderId),
        isNull(fuelOrders.deletedAt)
      ))
      .limit(1);

    if (!fuelOrderDetails.length) {
      return res.status(404).json({
        success: false,
        message: 'Fuel order not found'
      });
    }

    const fuelOrder = fuelOrderDetails[0];

    // Check access permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== fuelOrder.customerId && 
        currentUser.id !== fuelOrder.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: fuelOrder
    });
  } catch (error) {
    console.error('Get fuel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fuel order'
    });
  }
});

// PUT /api/fuel-orders/:id - Update fuel order details
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const fuelOrderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(fuelOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fuel order ID'
      });
    }

    const validatedData = updateFuelOrderSchema.parse(req.body);

    // Check if fuel order exists
    const existingFuelOrder = await db
      .select()
      .from(fuelOrders)
      .where(and(
        eq(fuelOrders.id, fuelOrderId),
        isNull(fuelOrders.deletedAt)
      ))
      .limit(1);

    if (!existingFuelOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Fuel order not found'
      });
    }

    const fuelOrder = existingFuelOrder[0];

    // Check permissions (only admin, customer, or assigned driver can update)
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== fuelOrder.customerId && 
        currentUser.id !== fuelOrder.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Validate driver if being updated
    if (validatedData.driverId) {
      const driver = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.driverId),
          eq(users.role, 'DRIVER'),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!driver.length) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found'
        });
      }
    }

    const updatedFuelOrder = await db
      .update(fuelOrders)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(fuelOrders.id, fuelOrderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'FUEL_ORDER_UPDATED',
      fuelOrderId,
      { stationId: fuelOrder.stationId, changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Fuel order updated successfully',
      data: updatedFuelOrder[0]
    });
  } catch (error) {
    console.error('Update fuel order error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update fuel order'
    });
  }
});

// POST /api/fuel-orders/:id/accept - Accept a fuel order
router.post('/:id/accept', requireAuth, requireRole(['DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const fuelOrderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(fuelOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fuel order ID'
      });
    }

    // Check if fuel order exists
    const existingFuelOrder = await db
      .select()
      .from(fuelOrders)
      .where(and(
        eq(fuelOrders.id, fuelOrderId),
        isNull(fuelOrders.deletedAt)
      ))
      .limit(1);

    if (!existingFuelOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Fuel order not found'
      });
    }

    const fuelOrder = existingFuelOrder[0];

    // Check if fuel order is in the right status
    if (fuelOrder.status !== 'PENDING' && fuelOrder.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        message: 'Fuel order cannot be accepted in current status'
      });
    }

    // For drivers, they can accept any unassigned order or their own assigned order
    if (currentUser.role === 'DRIVER' && fuelOrder.driverId && fuelOrder.driverId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'This fuel order is already assigned to another driver'
      });
    }

    // Update fuel order status and assign driver if not already assigned
    const updateData: any = {
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      updatedAt: new Date()
    };

    // If no driver is assigned and current user is a driver, assign them
    if (!fuelOrder.driverId && currentUser.role === 'DRIVER') {
      updateData.driverId = currentUser.id;
    }

    const updatedFuelOrder = await db
      .update(fuelOrders)
      .set(updateData)
      .where(eq(fuelOrders.id, fuelOrderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'FUEL_ORDER_ACCEPTED',
      fuelOrderId,
      { stationId: fuelOrder.stationId, acceptedBy: currentUser.role }
    );

    res.json({
      success: true,
      message: 'Fuel order accepted successfully',
      data: updatedFuelOrder[0]
    });
  } catch (error) {
    console.error('Accept fuel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept fuel order'
    });
  }
});

// POST /api/fuel-orders/:id/cancel - Cancel a fuel order
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const fuelOrderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason } = req.body;
    
    if (isNaN(fuelOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fuel order ID'
      });
    }

    // Check if fuel order exists
    const existingFuelOrder = await db
      .select()
      .from(fuelOrders)
      .where(and(
        eq(fuelOrders.id, fuelOrderId),
        isNull(fuelOrders.deletedAt)
      ))
      .limit(1);

    if (!existingFuelOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Fuel order not found'
      });
    }

    const fuelOrder = existingFuelOrder[0];

    // Check if fuel order can be cancelled
    if (fuelOrder.status === 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Delivered fuel orders cannot be cancelled'
      });
    }

    // Check permissions (customer, admin, or assigned driver can cancel)
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== fuelOrder.customerId && 
        currentUser.id !== fuelOrder.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updatedFuelOrder = await db
      .update(fuelOrders)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date()
      })
      .where(eq(fuelOrders.id, fuelOrderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'FUEL_ORDER_CANCELLED',
      fuelOrderId,
      { stationId: fuelOrder.stationId, cancelledBy: currentUser.role, reason }
    );

    res.json({
      success: true,
      message: 'Fuel order cancelled successfully',
      data: updatedFuelOrder[0]
    });
  } catch (error) {
    console.error('Cancel fuel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel fuel order'
    });
  }
});

// DELETE /api/fuel-orders/:id - Soft delete fuel order (Admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const fuelOrderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(fuelOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fuel order ID'
      });
    }

    // Check if fuel order exists
    const existingFuelOrder = await db
      .select()
      .from(fuelOrders)
      .where(and(
        eq(fuelOrders.id, fuelOrderId),
        isNull(fuelOrders.deletedAt)
      ))
      .limit(1);

    if (!existingFuelOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Fuel order not found'
      });
    }

    const fuelOrder = existingFuelOrder[0];

    // Perform soft delete
    await db
      .update(fuelOrders)
      .set({ deletedAt: new Date() })
      .where(eq(fuelOrders.id, fuelOrderId));

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'FUEL_ORDER_DELETED',
      fuelOrderId,
      { stationId: fuelOrder.stationId, status: fuelOrder.status }
    );

    res.json({
      success: true,
      message: 'Fuel order deleted successfully'
    });
  } catch (error) {
    console.error('Delete fuel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete fuel order'
    });
  }
});

export default router;
