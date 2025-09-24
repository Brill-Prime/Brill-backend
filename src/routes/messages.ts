
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { messages, users, orders, auditLogs } from '../db/schema';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createMessageSchema = z.object({
  receiverId: z.number().int().positive('Receiver ID must be a positive integer'),
  message: z.string().min(1, 'Message cannot be empty').max(1000, 'Message too long'),
  orderId: z.number().int().positive().optional(),
  supportTicketId: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.any()).optional().default({})
});

const messagesQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  search: z.string().optional(),
  orderId: z.string().optional(),
  supportTicketId: z.string().optional(),
  isRead: z.string().optional()
});

// Helper function to log audit activity
async function logAuditActivity(userId: number, action: string, entityType: string, entityId: number, details: any) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to log audit activity:', error);
  }
}

// POST /api/messages - Send a new message
router.post('/', requireAuth, async (req, res) => {
  try {
    const messageData = createMessageSchema.parse(req.body);
    const user = req.user!;

    // Verify receiver exists
    const [receiver] = await db
      .select()
      .from(users)
      .where(eq(users.id, messageData.receiverId))
      .limit(1);

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // If orderId is provided, verify the order exists and user has access
    if (messageData.orderId) {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, messageData.orderId))
        .limit(1);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      // Check if user is related to the order (customer, merchant, or driver)
      const isAuthorized = order.customerId === user.id || 
                          order.merchantId === user.id || 
                          order.driverId === user.id ||
                          messageData.receiverId === order.customerId ||
                          messageData.receiverId === order.merchantId ||
                          messageData.receiverId === order.driverId;

      if (!isAuthorized && user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to send messages for this order'
        });
      }
    }

    const [newMessage] = await db
      .insert(messages)
      .values({
        senderId: user.id,
        receiverId: messageData.receiverId,
        message: messageData.message,
        orderId: messageData.orderId,
        supportTicketId: messageData.supportTicketId,
        metadata: messageData.metadata
      })
      .returning();

    // Get the message with sender information
    const [messageWithSender] = await db
      .select({
        id: messages.id,
        message: messages.message,
        orderId: messages.orderId,
        supportTicketId: messages.supportTicketId,
        metadata: messages.metadata,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        sender: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.id, newMessage.id))
      .limit(1);

    // Log audit activity
    await logAuditActivity(
      user.id,
      'MESSAGE_SENT',
      'MESSAGE',
      newMessage.id,
      { receiverId: messageData.receiverId, orderId: messageData.orderId }
    );

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: messageWithSender
    });
  } catch (error) {
    console.error('Send message error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// GET /api/messages - List all messages (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const queryData = messagesQuerySchema.parse(req.query);
    const page = parseInt(queryData.page);
    const limit = parseInt(queryData.limit);
    const offset = (page - 1) * limit;

    // Build filter conditions
    const conditions = [];

    if (queryData.orderId) {
      conditions.push(eq(messages.orderId, parseInt(queryData.orderId)));
    }

    if (queryData.supportTicketId) {
      conditions.push(eq(messages.supportTicketId, parseInt(queryData.supportTicketId)));
    }

    if (queryData.isRead !== undefined) {
      conditions.push(eq(messages.isRead, queryData.isRead === 'true'));
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get messages with sender and receiver information
    const messagesList = await db
      .select({
        id: messages.id,
        message: messages.message,
        orderId: messages.orderId,
        supportTicketId: messages.supportTicketId,
        metadata: messages.metadata,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        sender: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(whereCondition)
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(messages)
      .where(whereCondition);

    res.json({
      success: true,
      data: messagesList,
      pagination: {
        page,
        limit,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limit)
      }
    });
  } catch (error) {
    console.error('List messages error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve messages'
    });
  }
});

// GET /api/messages/user/:id - List messages by user
router.get('/user/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = req.user!;
    const queryData = messagesQuerySchema.parse(req.query);
    const page = parseInt(queryData.page);
    const limit = parseInt(queryData.limit);
    const offset = (page - 1) * limit;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Non-admin users can only see their own messages
    if (user.role !== 'ADMIN' && user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
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
        message: 'User not found'
      });
    }

    // Build filter conditions
    const conditions = [
      or(
        eq(messages.senderId, userId),
        eq(messages.receiverId, userId)
      )
    ];

    if (queryData.orderId) {
      conditions.push(eq(messages.orderId, parseInt(queryData.orderId)));
    }

    if (queryData.supportTicketId) {
      conditions.push(eq(messages.supportTicketId, parseInt(queryData.supportTicketId)));
    }

    const whereCondition = and(...conditions);

    // Get messages with sender and receiver information
    const messagesList = await db
      .select({
        id: messages.id,
        message: messages.message,
        orderId: messages.orderId,
        supportTicketId: messages.supportTicketId,
        metadata: messages.metadata,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        senderId: messages.senderId,
        receiverId: messages.receiverId,
        sender: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(whereCondition)
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    // Mark messages as read if user is the receiver
    if (user.id === userId) {
      const unreadMessageIds = messagesList
        .filter(msg => !msg.isRead && msg.receiverId === userId)
        .map(msg => msg.id);

      if (unreadMessageIds.length > 0) {
        await db
          .update(messages)
          .set({ isRead: true })
          .where(and(
            eq(messages.receiverId, userId),
            eq(messages.isRead, false)
          ));
      }
    }

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(messages)
      .where(whereCondition);

    res.json({
      success: true,
      data: messagesList,
      pagination: {
        page,
        limit,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limit)
      }
    });
  } catch (error) {
    console.error('List user messages error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user messages'
    });
  }
});

// GET /api/messages/order/:id - List messages by order
router.get('/order/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const user = req.user!;
    const queryData = messagesQuerySchema.parse(req.query);
    const page = parseInt(queryData.page);
    const limit = parseInt(queryData.limit);
    const offset = (page - 1) * limit;

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

    // Check if user is related to the order or is admin
    const isAuthorized = order.customerId === user.id || 
                        order.merchantId === user.id || 
                        order.driverId === user.id ||
                        user.role === 'ADMIN';

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get messages for this order with sender information
    const messagesList = await db
      .select({
        id: messages.id,
        message: messages.message,
        orderId: messages.orderId,
        supportTicketId: messages.supportTicketId,
        metadata: messages.metadata,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        senderId: messages.senderId,
        receiverId: messages.receiverId,
        sender: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.orderId, orderId))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    // Mark messages as read if user is the receiver
    const unreadMessageIds = messagesList
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

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(messages)
      .where(eq(messages.orderId, orderId));

    res.json({
      success: true,
      data: messagesList,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customerId: order.customerId,
        merchantId: order.merchantId,
        driverId: order.driverId
      },
      pagination: {
        page,
        limit,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limit)
      }
    });
  } catch (error) {
    console.error('List order messages error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve order messages'
    });
  }
});

export default router;
