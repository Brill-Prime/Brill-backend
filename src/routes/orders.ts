
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

export default router;
