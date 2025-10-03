
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { orders, driverProfiles, users, auditLogs, tracking } from '../db/schema';
import { eq, and, desc, isNull, or } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';
import { getWebSocketService } from '../services/websocket';

const router = express.Router();

// Validation schemas
const updateLocationSchema = z.object({
  latitude: z.string().refine((val) => !isNaN(Number(val)) && Math.abs(Number(val)) <= 90, {
    message: "Latitude must be a valid number between -90 and 90"
  }),
  longitude: z.string().refine((val) => !isNaN(Number(val)) && Math.abs(Number(val)) <= 180, {
    message: "Longitude must be a valid number between -180 and 180"
  }),
  status: z.string().optional(),
  heading: z.number().optional(),
  speed: z.number().optional()
});

const rejectReasonSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required')
});

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

// GET /driver/orders - Get all orders for the authenticated driver
router.get('/orders', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const driverId = req.user!.id;
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [
      eq(orders.driverId, driverId),
      isNull(orders.deletedAt)
    ];

    if (status) {
      conditions.push(eq(orders.status, status as any));
    }

    // Get driver's orders with customer information
    const driverOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        customerName: users.fullName,
        customerPhone: users.phone,
        merchantId: orders.merchantId,
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
    const totalCountResult = await db
      .select({ count: orders.id })
      .from(orders)
      .where(and(...conditions));

    const totalCount = totalCountResult.length;

    res.json({
      success: true,
      data: driverOrders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get driver orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch driver orders'
    });
  }
});

// POST /driver/orders/:id/accept - Accept an order assignment
router.post('/orders/:id/accept', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const driverId = req.user!.id;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and is assigned to this driver
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.driverId, driverId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or not assigned to you'
      });
    }

    const order = existingOrder[0];

    // Check if order is in the right status to be accepted
    if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        message: `Order cannot be accepted in current status: ${order.status}`
      });
    }

    // Update order status to ACCEPTED
    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Update driver availability
    await db
      .update(driverProfiles)
      .set({
        isAvailable: false,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.userId, driverId));

    // Create initial tracking entry
    const driverProfile = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId))
      .limit(1);

    if (driverProfile.length && driverProfile[0].currentLatitude && driverProfile[0].currentLongitude) {
      await db.insert(tracking).values({
        orderId: orderId,
        driverId: driverId,
        latitude: driverProfile[0].currentLatitude,
        longitude: driverProfile[0].currentLongitude,
        status: 'ACCEPTED',
        timestamp: new Date()
      });
    }

    // Log audit event
    await logAuditEvent(
      driverId,
      'ORDER_ACCEPTED_BY_DRIVER',
      orderId,
      { orderNumber: order.orderNumber }
    );

    // Send real-time notification to customer
    const wsService = getWebSocketService();
    if (wsService && order.customerId) {
      await wsService.sendNotificationToUser(order.customerId.toString(), {
        type: 'ORDER_ACCEPTED',
        title: 'Order Accepted',
        message: `Your order ${order.orderNumber} has been accepted by the driver`,
        data: { orderId, status: 'ACCEPTED' }
      });
    }

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

// POST /driver/orders/:id/reject - Reject an order assignment
router.post('/orders/:id/reject', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const driverId = req.user!.id;
    const validatedData = rejectReasonSchema.parse(req.body);

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and is assigned to this driver
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.driverId, driverId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or not assigned to you'
      });
    }

    const order = existingOrder[0];

    // Check if order can be rejected
    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: `Order cannot be rejected in current status: ${order.status}`
      });
    }

    // Update order - clear driver assignment and set status back to PENDING
    const updatedOrder = await db
      .update(orders)
      .set({
        driverId: null,
        driverEarnings: null,
        status: 'PENDING',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Update driver availability back to available
    await db
      .update(driverProfiles)
      .set({
        isAvailable: true,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.userId, driverId));

    // Log audit event
    await logAuditEvent(
      driverId,
      'ORDER_REJECTED_BY_DRIVER',
      orderId,
      { 
        orderNumber: order.orderNumber,
        reason: validatedData.reason
      }
    );

    // Send real-time notification to customer and merchant
    const wsService = getWebSocketService();
    if (wsService) {
      if (order.customerId) {
        await wsService.sendNotificationToUser(order.customerId.toString(), {
          type: 'ORDER_REJECTED',
          title: 'Order Rejected',
          message: `Your order ${order.orderNumber} was rejected by the driver. We're finding you another driver.`,
          data: { orderId, status: 'PENDING' }
        });
      }

      if (order.merchantId) {
        await wsService.sendNotificationToUser(order.merchantId.toString(), {
          type: 'ORDER_REJECTED',
          title: 'Driver Rejected Order',
          message: `Order ${order.orderNumber} was rejected. Reason: ${validatedData.reason}`,
          data: { orderId, status: 'PENDING', reason: validatedData.reason }
        });
      }
    }

    res.json({
      success: true,
      message: 'Order rejected successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Reject order error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to reject order'
    });
  }
});

// POST /driver/orders/:id/update-location - Update driver location during delivery
router.post('/orders/:id/update-location', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const driverId = req.user!.id;
    const validatedData = updateLocationSchema.parse(req.body);

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and is assigned to this driver
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.driverId, driverId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or not assigned to you'
      });
    }

    const order = existingOrder[0];

    // Check if order is in an active delivery status
    if (order.status !== 'ACCEPTED' && order.status !== 'PICKED_UP' && order.status !== 'IN_TRANSIT') {
      return res.status(400).json({
        success: false,
        message: `Cannot update location for order in status: ${order.status}`
      });
    }

    // Update driver's current location in profile
    await db
      .update(driverProfiles)
      .set({
        currentLatitude: validatedData.latitude,
        currentLongitude: validatedData.longitude,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.userId, driverId));

    // Insert tracking entry
    const trackingStatus = validatedData.status || order.status;
    await db.insert(tracking).values({
      orderId: orderId,
      driverId: driverId,
      latitude: validatedData.latitude,
      longitude: validatedData.longitude,
      status: trackingStatus,
      timestamp: new Date()
    });

    // Send real-time location update to customer
    const wsService = getWebSocketService();
    if (wsService && order.customerId) {
      await wsService.sendNotificationToUser(order.customerId.toString(), {
        type: 'DRIVER_LOCATION_UPDATE',
        title: 'Driver Location Updated',
        message: 'Your driver is on the way',
        data: {
          orderId,
          latitude: validatedData.latitude,
          longitude: validatedData.longitude,
          heading: validatedData.heading,
          speed: validatedData.speed,
          status: trackingStatus
        }
      });
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        orderId,
        latitude: validatedData.latitude,
        longitude: validatedData.longitude,
        status: trackingStatus,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Update location error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
});

// POST /driver/orders/:id/mark-delivered - Mark order as delivered
router.post('/orders/:id/mark-delivered', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const driverId = req.user!.id;
    const { notes } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and is assigned to this driver
    const existingOrder = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.driverId, driverId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!existingOrder.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or not assigned to you'
      });
    }

    const order = existingOrder[0];

    // Check if order is in the right status
    if (order.status !== 'PICKED_UP' && order.status !== 'IN_TRANSIT') {
      return res.status(400).json({
        success: false,
        message: `Order must be picked up before marking as delivered. Current status: ${order.status}`
      });
    }

    // Update order status to DELIVERED
    const updatedOrder = await db
      .update(orders)
      .set({
        status: 'DELIVERED',
        deliveredAt: new Date(),
        confirmationDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours for confirmation
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId))
      .returning();

    // Update driver availability back to available
    // Get current total deliveries first
    const currentDriver = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId))
      .limit(1);
    
    await db
      .update(driverProfiles)
      .set({
        isAvailable: true,
        totalDeliveries: (currentDriver[0]?.totalDeliveries || 0) + 1,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.userId, driverId));

    // Create final tracking entry
    const driverProfile = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, driverId))
      .limit(1);

    if (driverProfile.length && driverProfile[0].currentLatitude && driverProfile[0].currentLongitude) {
      await db.insert(tracking).values({
        orderId: orderId,
        driverId: driverId,
        latitude: driverProfile[0].currentLatitude,
        longitude: driverProfile[0].currentLongitude,
        status: 'DELIVERED',
        timestamp: new Date()
      });
    }

    // Log audit event
    await logAuditEvent(
      driverId,
      'ORDER_DELIVERED_BY_DRIVER',
      orderId,
      { 
        orderNumber: order.orderNumber,
        notes: notes || null
      }
    );

    // Send real-time notification to customer
    const wsService = getWebSocketService();
    if (wsService && order.customerId) {
      await wsService.sendNotificationToUser(order.customerId.toString(), {
        type: 'ORDER_DELIVERED',
        title: 'Order Delivered',
        message: `Your order ${order.orderNumber} has been delivered. Please confirm receipt.`,
        data: { 
          orderId, 
          status: 'DELIVERED',
          deliveredAt: new Date().toISOString()
        }
      });
    }

    res.json({
      success: true,
      message: 'Order marked as delivered successfully',
      data: updatedOrder[0]
    });
  } catch (error) {
    console.error('Mark delivered error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark order as delivered'
    });
  }
});

export default router;
