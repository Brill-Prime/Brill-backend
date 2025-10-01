
import express from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../utils/auth';
import { getWebSocketService } from '../services/websocket';
import { db } from '../db/config';
import { orders, users, messages, tracking } from '../db/schema';
import { eq, and, or, desc, gte, lte } from 'drizzle-orm';

const router = express.Router();

// Validation schemas
const sendBroadcastSchema = z.object({
  type: z.string().min(1),
  data: z.any(),
  targetUsers: z.array(z.number()).optional(),
  targetRoles: z.array(z.string()).optional()
});

const orderUpdateSchema = z.object({
  orderId: z.number().int().positive(),
  status: z.string().optional(),
  message: z.string().optional(),
  metadata: z.any().optional()
});

const chatRoomSchema = z.object({
  orderId: z.number().int().positive().optional(),
  supportTicketId: z.number().int().positive().optional(),
  participants: z.array(z.number()).optional()
});

// GET /api/realtime/status - Get WebSocket service status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const wsService = getWebSocketService();
    
    if (!wsService) {
      return res.status(503).json({
        success: false,
        message: 'WebSocket service not available'
      });
    }

    const status = {
      isRunning: true,
      connectedClients: wsService.getConnectedClients(),
      userConnections: wsService.getUserConnectionCount(req.user!.id),
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Get WebSocket status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get WebSocket status'
    });
  }
});

// POST /api/realtime/broadcast - Send broadcast message (Admin only)
router.post('/broadcast', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const validatedData = sendBroadcastSchema.parse(req.body);
    const wsService = getWebSocketService();

    if (!wsService) {
      return res.status(503).json({
        success: false,
        message: 'WebSocket service not available'
      });
    }

    // For now, we'll implement basic broadcasting
    // In a more advanced implementation, you'd have room/channel management
    
    res.json({
      success: true,
      message: 'Broadcast message queued',
      data: {
        type: validatedData.type,
        targetUsers: validatedData.targetUsers?.length || 'all',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Broadcast error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send broadcast'
    });
  }
});

// POST /api/realtime/order-update - Send order update to participants
router.post('/order-update', requireAuth, async (req, res) => {
  try {
    const validatedData = orderUpdateSchema.parse(req.body);
    const wsService = getWebSocketService();

    if (!wsService) {
      return res.status(503).json({
        success: false,
        message: 'WebSocket service not available'
      });
    }

    // Verify user has access to this order
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, validatedData.orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const user = req.user!;
    const hasAccess = order.customerId === user.id || 
                     order.merchantId === user.id || 
                     order.driverId === user.id ||
                     user.role === 'ADMIN';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update order status if provided
    if (validatedData.status) {
      await db
        .update(orders)
        .set({ 
          status: validatedData.status as any,
          updatedAt: new Date()
        })
        .where(eq(orders.id, validatedData.orderId));
    }

    // Send real-time update
    await wsService.broadcastOrderUpdate(validatedData.orderId, {
      type: 'order_status_update',
      data: {
        orderId: validatedData.orderId,
        status: validatedData.status,
        message: validatedData.message,
        metadata: validatedData.metadata,
        updatedBy: user.id
      }
    });

    res.json({
      success: true,
      message: 'Order update sent successfully',
      data: {
        orderId: validatedData.orderId,
        status: validatedData.status
      }
    });

  } catch (error) {
    console.error('Order update error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send order update'
    });
  }
});

// GET /api/realtime/order/:orderId/tracking - Get live tracking for order
router.get('/order/:orderId/tracking', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Verify order exists and user has access
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const user = req.user!;
    const hasAccess = order.customerId === user.id || 
                     order.merchantId === user.id || 
                     order.driverId === user.id ||
                     user.role === 'ADMIN';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get recent tracking data (last 50 points)
    const trackingData = await db
      .select({
        id: tracking.id,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        timestamp: tracking.timestamp,
        createdAt: tracking.createdAt,
        driver: {
          id: users.id,
          fullName: users.fullName
        }
      })
      .from(tracking)
      .leftJoin(users, eq(tracking.driverId, users.id))
      .where(eq(tracking.orderId, orderId))
      .orderBy(desc(tracking.createdAt))
      .limit(50);

    res.json({
      success: true,
      data: {
        orderId,
        tracking: trackingData.reverse(), // Show chronological order
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          customerId: order.customerId,
          driverId: order.driverId,
          merchantId: order.merchantId
        },
        websocketEndpoint: '/ws',
        lastUpdated: trackingData[trackingData.length - 1]?.createdAt
      }
    });

  } catch (error) {
    console.error('Get order tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get order tracking'
    });
  }
});

// GET /api/realtime/chat/:orderId - Get chat messages for order
router.get('/chat/:orderId', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { page = '1', limit = '50' } = req.query;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    // Verify order exists and user has access
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const user = req.user!;
    const hasAccess = order.customerId === user.id || 
                     order.merchantId === user.id || 
                     order.driverId === user.id ||
                     user.role === 'ADMIN';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get chat messages
    const chatMessages = await db
      .select({
        id: messages.id,
        message: messages.message,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        senderId: messages.senderId,
        receiverId: messages.receiverId,
        sender: {
          id: users.id,
          fullName: users.fullName,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.orderId, orderId))
      .orderBy(desc(messages.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Mark messages as read if user is the receiver
    const unreadMessageIds = chatMessages
      .filter(msg => !msg.isRead && msg.receiverId === user.id)
      .map(msg => msg.id);

    if (unreadMessageIds.length > 0) {
      await db
        .update(messages)
        .set({ isRead: true })
        .where(and(
          eq(messages.orderId, orderId),
          eq(messages.receiverId, user.id),
          eq(messages.isRead, false)
        ));
    }

    res.json({
      success: true,
      data: {
        orderId,
        messages: chatMessages.reverse(), // Show chronological order
        participants: {
          customer: order.customerId,
          merchant: order.merchantId,
          driver: order.driverId
        },
        websocketEndpoint: '/ws',
        pagination: {
          page: pageNum,
          limit: limitNum,
          hasMore: chatMessages.length === limitNum
        }
      }
    });

  } catch (error) {
    console.error('Get chat messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat messages'
    });
  }
});

// POST /api/realtime/notification - Send notification to user
router.post('/notification', requireAuth, requireRole(['ADMIN', 'MERCHANT', 'DRIVER']), async (req, res) => {
  try {
    const { userId, title, message, type, metadata = {} } = req.body;
    const wsService = getWebSocketService();

    if (!wsService) {
      return res.status(503).json({
        success: false,
        message: 'WebSocket service not available'
      });
    }

    // Verify target user exists
    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }

    // Send real-time notification
    await wsService.sendNotificationToUser(userId, {
      title,
      message,
      type,
      metadata,
      fromUserId: req.user!.id
    });

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        userId,
        title,
        type
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

export default router;
