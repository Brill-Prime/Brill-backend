
import express from 'express';
import { db } from '../db/config';
import { orders, users, auditLogs, products } from '../db/schema';
import { eq, isNull, desc, and, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createOrderSchema = z.object({
  orderType: z.string().min(1),
  totalAmount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Total amount must be a positive number"
  }),
  deliveryAddress: z.string().min(1),
  pickupAddress: z.string().optional(),
  deliveryLatitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery latitude must be a valid number"
  }),
  deliveryLongitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery longitude must be a valid number"
  }),
  orderData: z.any().default({}),
  merchantId: z.number().int().positive().optional(),
  driverId: z.number().int().positive().optional(),
  driverEarnings: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Number(val) >= 0), {
    message: "Driver earnings must be a non-negative number"
  })
});

const updateOrderSchema = z.object({
  orderType: z.string().min(1).optional(),
  totalAmount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Total amount must be a positive number"
  }).optional(),
  deliveryAddress: z.string().min(1).optional(),
  pickupAddress: z.string().optional(),
  deliveryLatitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery latitude must be a valid number"
  }),
  deliveryLongitude: z.string().optional().refine((val) => !val || !isNaN(Number(val)), {
    message: "Delivery longitude must be a valid number"
  }),
  orderData: z.any().optional(),
  merchantId: z.number().int().positive().optional(),
  driverId: z.number().int().positive().optional(),
  driverEarnings: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Number(val) >= 0), {
    message: "Driver earnings must be a non-negative number"
  }),
  status: z.enum(['PENDING', 'CONFIRMED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']).optional()
});

// Helper function to generate order number
const generateOrderNumber = (): string => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ORD${timestamp}${random}`;
};

// Helper function to log audit events
const logAuditEvent = async (userId: number, action: string, entityId: number, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'ORDER',
      entityId,
      details,
      ipAddress: '',
      userAgent: ''
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

// POST /api/orders - Create a new order
router.post('/', requireAuth, async (req, res) => {
  try {
    const validatedData = createOrderSchema.parse(req.body);
    const currentUser = req.user!;

    // Generate unique order number
    let orderNumber: string;
    let isUnique = false;
    let attempts = 0;
    
    do {
      orderNumber = generateOrderNumber();
      const existingOrder = await db
        .select()
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      
      isUnique = existingOrder.length === 0;
      attempts++;
    } while (!isUnique && attempts < 10);

    if (!isUnique) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate unique order number'
      });
    }

    // Validate merchant if specified
    if (validatedData.merchantId) {
      const merchant = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.merchantId),
          eq(users.role, 'MERCHANT'),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!merchant.length) {
        return res.status(404).json({
          success: false,
          message: 'Merchant not found'
        });
      }
    }

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

    const newOrder = await db.insert(orders).values({
      orderNumber,
      customerId: currentUser.id,
      merchantId: validatedData.merchantId || null,
      driverId: validatedData.driverId || null,
      orderType: validatedData.orderType,
      totalAmount: validatedData.totalAmount,
      driverEarnings: validatedData.driverEarnings || null,
      deliveryAddress: validatedData.deliveryAddress,
      pickupAddress: validatedData.pickupAddress || null,
      deliveryLatitude: validatedData.deliveryLatitude || null,
      deliveryLongitude: validatedData.deliveryLongitude || null,
      orderData: validatedData.orderData,
      confirmationDeadline,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_CREATED',
      newOrder[0].id,
      { orderNumber: newOrder[0].orderNumber, orderType: validatedData.orderType }
    );

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: newOrder[0]
    });
  } catch (error) {
    console.error('Create order error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create order'
    });
  }
});

// GET /api/orders - List all orders (Admin only, or user's own orders)
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const orderType = req.query.orderType as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(orders.deletedAt)];

    // Non-admin users can only see their own orders
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(orders.customerId, currentUser.id),
          eq(orders.merchantId, currentUser.id),
          eq(orders.driverId, currentUser.id)
        )!
      );
    }

    if (search) {
      conditions.push(ilike(orders.orderNumber, `%${search}%`));
    }

    if (status) {
      conditions.push(eq(orders.status, status as any));
    }

    if (orderType) {
      conditions.push(eq(orders.orderType, orderType));
    }

    const allOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        customerName: users.fullName,
        merchantId: orders.merchantId,
        driverId: orders.driverId,
        orderType: orders.orderType,
        status: orders.status,
        totalAmount: orders.totalAmount,
        driverEarnings: orders.driverEarnings,
        deliveryAddress: orders.deliveryAddress,
        pickupAddress: orders.pickupAddress,
        deliveryLatitude: orders.deliveryLatitude,
        deliveryLongitude: orders.deliveryLongitude,
        orderData: orders.orderData,
        acceptedAt: orders.acceptedAt,
        pickedUpAt: orders.pickedUpAt,
        deliveredAt: orders.deliveredAt,
        confirmationDeadline: orders.confirmationDeadline,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt
      })
      .from(orders)
      .leftJoin(users, eq(orders.customerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: orders.id })
      .from(orders)
      .where(and(...conditions));

    res.json({
      success: true,
      data: allOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.length / limit),
        totalItems: totalCount.length,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
});

// GET /api/orders/:id - Get order details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    const orderDetails = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        customerName: users.fullName,
        customerEmail: users.email,
        merchantId: orders.merchantId,
        driverId: orders.driverId,
        orderType: orders.orderType,
        status: orders.status,
        totalAmount: orders.totalAmount,
        driverEarnings: orders.driverEarnings,
        deliveryAddress: orders.deliveryAddress,
        pickupAddress: orders.pickupAddress,
        deliveryLatitude: orders.deliveryLatitude,
        deliveryLongitude: orders.deliveryLongitude,
        orderData: orders.orderData,
        acceptedAt: orders.acceptedAt,
        pickedUpAt: orders.pickedUpAt,
        deliveredAt: orders.deliveredAt,
        confirmationDeadline: orders.confirmationDeadline,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt
      })
      .from(orders)
      .leftJoin(users, eq(orders.customerId, users.id))
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!orderDetails.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = orderDetails[0];

    // Check access permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.customerId && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
});

// PUT /api/orders/:id - Update order details
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    const validatedData = updateOrderSchema.parse(req.body);

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (only admin, customer, or assigned merchant/driver can update)
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.customerId && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Validate merchant if being updated
    if (validatedData.merchantId) {
      const merchant = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, validatedData.merchantId),
          eq(users.role, 'MERCHANT'),
          isNull(users.deletedAt)
        ))
        .limit(1);

      if (!merchant.length) {
        return res.status(404).json({
          success: false,
          message: 'Merchant not found'
        });
      }
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

    const updatedOrder = await db
      .update(orders)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_UPDATED',
      orderId,
      { orderNumber: order.orderNumber, changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Update order error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update order'
    });
  }
});

// DELETE /api/orders/:id - Soft delete an order
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Only admin or the customer can delete an order
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only admin or the customer can delete an order'
      });
    }

    // Soft delete the order
    await db
      .update(orders)
      .set({
        deletedAt: new Date(),
        status: 'CANCELLED'
      })
      .where(eq(orders.id, orderId));

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_DELETED',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete order'
    });
  }
});

// POST /api/orders/:id/accept - Accept an order (Merchant/Driver)
router.post('/:id/accept', requireAuth, requireRole(['MERCHANT', 'DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check if order is in the right status
    if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be accepted in current status'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'You can only accept orders assigned to you'
      });
    }

    // Update order status and acceptance time
    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_ACCEPTED',
      orderId,
      { orderNumber: order.orderNumber, acceptedBy: currentUser.role }
    );

    res.json({
      success: true,
      message: 'Order accepted successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Accept order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept order'
    });
  }
});

// POST /api/orders/:id/reject - Reject an order
router.post('/:id/reject', requireAuth, requireRole(['MERCHANT', 'DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason } = req.body;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check if order can be rejected
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be rejected in current status'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'You can only reject orders assigned to you'
      });
    }

    // Clear assignment if rejected by merchant/driver
    let updateData: any = {
      status: 'PENDING',
      updatedAt: new Date()
    };

    if (currentUser.id === order.merchantId) {
      updateData.merchantId = null;
    }
    if (currentUser.id === order.driverId) {
      updateData.driverId = null;
    }

    const updatedOrder = await db
      .update(orders)
      .set(updateData)
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_REJECTED',
      orderId,
      { orderNumber: order.orderNumber, rejectedBy: currentUser.role, reason }
    );

    res.json({
      success: true,
      message: 'Order rejected successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Reject order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject order'
    });
  }
});

// POST /api/orders/:id/cancel - Cancel an order
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason } = req.body;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check if order can be cancelled
    if (order.status === 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Delivered orders cannot be cancelled'
      });
    }

    // Check permissions (customer, admin, or assigned merchant/driver can cancel)
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.customerId && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_CANCELLED',
      orderId,
      { orderNumber: order.orderNumber, cancelledBy: currentUser.role, reason }
    );

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order'
    });
  }
});

// POST /api/orders/:id/pickup - Mark order as picked up
router.post('/:id/pickup', requireAuth, requireRole(['DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check if order is in the right status
    if (order.status !== 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        message: 'Order must be accepted before pickup'
      });
    }

    // Check permissions (only assigned driver or admin)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned driver can mark order as picked up'
      });
    }

    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'PICKED_UP',
        pickedUpAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_PICKED_UP',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Order marked as picked up successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Pickup order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark order as picked up'
    });
  }
});

// POST /api/orders/:id/deliver - Mark order as delivered
router.post('/:id/deliver', requireAuth, requireRole(['DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check if order is in the right status
    if (order.status !== 'PICKED_UP' && order.status !== 'IN_TRANSIT') {
      return res.status(400).json({
        success: false,
        message: 'Order must be picked up before delivery'
      });
    }

    // Check permissions (only assigned driver or admin)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned driver can mark order as delivered'
      });
    }

    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'DELIVERED',
        deliveredAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_DELIVERED',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Order marked as delivered successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Deliver order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark order as delivered'
    });
  }
});

// POST /api/orders/:id/assign-driver - Assign a driver to an order
router.post('/:id/assign-driver', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { driverId } = req.body;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    if (!driverId || isNaN(parseInt(driverId))) {
      return res.status(400).json({
        success: false,
        message: 'Valid driver ID is required'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (merchant must own the order or be admin)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Only the merchant or admin can assign drivers'
      });
    }

    // Verify driver exists and is available
    const driver = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, parseInt(driverId)),
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

    // Update order with driver assignment
    const updatedOrder = await db
      .update(orders)
      .set({
        driverId: parseInt(driverId),
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DRIVER_ASSIGNED',
      orderId,
      { orderNumber: order.orderNumber, driverId: parseInt(driverId) }
    );

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign driver'
    });
  }
});

// POST /api/orders/:id/mark-ready - Mark order as ready for pickup
router.post('/:id/mark-ready', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (merchant must own the order or be admin)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Only the merchant or admin can mark order as ready'
      });
    }

    // Check if order is in the right status
    if (order.status !== 'CONFIRMED' && order.status !== 'ACCEPTED') {
      return res.status(400).json({
        success: false,
        message: 'Order must be confirmed or accepted to mark as ready'
      });
    }

    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'IN_TRANSIT',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_READY_FOR_PICKUP',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Order marked as ready for pickup',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Mark ready error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark order as ready'
    });
  }
});

// POST /api/orders/:id/confirm-delivery - Customer confirms delivery receipt
router.post('/:id/confirm-delivery', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (only customer can confirm delivery)
    if (currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer can confirm delivery'
      });
    }

    // Check if order is delivered
    if (order.status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Order must be delivered before confirmation'
      });
    }

    // Update order with confirmation deadline (48 hours from now for auto-release)
    const updatedOrder = await db
      .update(orders)
      .set({
        confirmationDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DELIVERY_CONFIRMED_BY_CUSTOMER',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Delivery confirmed successfully. Funds will be released within 48 hours.',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm delivery'
    });
  }
});

// POST /api/orders/:id/complete - Mark order as complete (final state)
router.post('/:id/complete', requireAuth, requireRole(['DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (only assigned driver or admin)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned driver or admin can complete the order'
      });
    }

    // Check if order is delivered
    if (order.status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Order must be delivered before completion'
      });
    }

    const updatedOrder = await db
      .update(orders)
      .set({
        confirmationDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_COMPLETED',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Order completed successfully. Awaiting customer confirmation.',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Complete order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete order'
    });
  }
});

// POST /api/orders/:id/pay - Process payment for order
router.post('/:id/pay', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { paymentMethod, paystackReference } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Only customer can pay for order
    if (currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer can pay for this order'
      });
    }

    // Check if order is in the right status
    if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be paid in current status'
      });
    }

    // Update order status to confirmed
    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'CONFIRMED',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_PAYMENT_PROCESSED',
      orderId,
      { orderNumber: order.orderNumber, paymentMethod, paystackReference }
    );

    res.json({
      success: true,
      message: 'Payment processed successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment'
    });
  }
});

// POST /api/orders/:id/release-payment - Release payment to merchant and driver
router.post('/:id/release-payment', requireAuth, requireRole(['ADMIN', 'CUSTOMER']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (customer or admin)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer or admin can release payment'
      });
    }

    // Check if order is delivered
    if (order.status !== 'DELIVERED') {
      return res.status(400).json({
        success: false,
        message: 'Payment can only be released after delivery'
      });
    }

    // Update confirmation deadline to trigger release
    const updatedOrder = await db
      .update(orders)
      .set({
        confirmationDeadline: new Date(Date.now() + 5000), // 5 seconds for immediate processing
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'PAYMENT_RELEASE_INITIATED',
      orderId,
      { orderNumber: order.orderNumber }
    );

    res.json({
      success: true,
      message: 'Payment release initiated. Funds will be transferred shortly.',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Release payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release payment'
    });
  }
});

// POST /api/orders/:id/dispute - Raise a dispute for order
router.post('/:id/dispute', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason, description } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        message: 'Reason and description are required'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions (customer, merchant, or driver)
    if (currentUser.id !== order.customerId && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Cannot dispute cancelled orders
    if (order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot dispute cancelled orders'
      });
    }

    // Log audit event with dispute details
    await logAuditEvent(
      currentUser.id,
      'ORDER_DISPUTED',
      orderId,
      { 
        orderNumber: order.orderNumber, 
        reason, 
        description,
        disputedBy: currentUser.role
      }
    );

    res.json({
      success: true,
      message: 'Dispute raised successfully. Our team will review and contact you shortly.',
      data: {
        orderId,
        disputeReason: reason,
        disputeDescription: description
      }
    });
  } catch (error) {
    console.error('Dispute order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to raise dispute'
    });
  }
});

// POST /api/orders/:id/refund - Request refund for order
router.post('/:id/refund', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { reason, amount } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Only customer or admin can request refund
    if (currentUser.role !== 'ADMIN' && currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer or admin can request refund'
      });
    }

    // Validate refund amount if provided
    const refundAmount = amount || order.totalAmount;
    if (parseFloat(refundAmount) <= 0 || parseFloat(refundAmount) > parseFloat(order.totalAmount)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid refund amount'
      });
    }

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'REFUND_REQUESTED',
      orderId,
      { 
        orderNumber: order.orderNumber, 
        reason,
        refundAmount
      }
    );

    res.json({
      success: true,
      message: 'Refund request submitted successfully. Our team will process it shortly.',
      data: {
        orderId,
        refundAmount,
        refundReason: reason
      }
    });
  } catch (error) {
    console.error('Refund request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to request refund'
    });
  }
});

// GET /api/orders/:id/tracking - Get tracking information for order
router.get('/:id/tracking', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.customerId && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        orderId,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryAddress: order.deliveryAddress,
        pickupAddress: order.pickupAddress,
        deliveryLatitude: order.deliveryLatitude,
        deliveryLongitude: order.deliveryLongitude,
        acceptedAt: order.acceptedAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        estimatedDelivery: order.confirmationDeadline
      }
    });
  } catch (error) {
    console.error('Get tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tracking information'
    });
  }
});

// POST /api/orders/:id/notify - Send notification for order
router.post('/:id/notify', requireAuth, requireRole(['MERCHANT', 'DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const currentUser = req.user!;
    const { message, notificationType } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Check if order exists
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = existingOrder[0];

    // Check permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.merchantId && 
        currentUser.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Only merchant, driver, or admin can send notifications'
      });
    }

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'ORDER_NOTIFICATION_SENT',
      orderId,
      { 
        orderNumber: order.orderNumber, 
        message,
        notificationType,
        sentBy: currentUser.role
      }
    );

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        orderId,
        message,
        notificationType
      }
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification'
    });
  }
});

// GET /api/orders/active - Get active orders for current user
router.get('/active', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;

    // Build conditions based on user role
    const conditions = [isNull(orders.deletedAt)];

    // Active orders are those not delivered or cancelled
    conditions.push(
      and(
        or(
          eq(orders.status, 'PENDING'),
          eq(orders.status, 'CONFIRMED'),
          eq(orders.status, 'ACCEPTED'),
          eq(orders.status, 'PICKED_UP'),
          eq(orders.status, 'IN_TRANSIT')
        )!
      )!
    );

    // Filter by user role
    if (currentUser.role === 'CONSUMER') {
      conditions.push(eq(orders.customerId, currentUser.id));
    } else if (currentUser.role === 'MERCHANT') {
      conditions.push(eq(orders.merchantId, currentUser.id));
    } else if (currentUser.role === 'DRIVER') {
      conditions.push(eq(orders.driverId, currentUser.id));
    }
    // Admin sees all active orders

    const activeOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        customerName: users.fullName,
        merchantId: orders.merchantId,
        driverId: orders.driverId,
        orderType: orders.orderType,
        status: orders.status,
        totalAmount: orders.totalAmount,
        deliveryAddress: orders.deliveryAddress,
        pickupAddress: orders.pickupAddress,
        acceptedAt: orders.acceptedAt,
        pickedUpAt: orders.pickedUpAt,
        createdAt: orders.createdAt
      })
      .from(orders)
      .leftJoin(users, eq(orders.customerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt));

    res.json({
      success: true,
      data: activeOrders,
      count: activeOrders.length
    });
  } catch (error) {
    console.error('Get active orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active orders'
    });
  }
});

export default router;
