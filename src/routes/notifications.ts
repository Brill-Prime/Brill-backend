
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { notifications, users, auditLogs } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createNotificationSchema = z.object({
  userId: z.number().int().positive('User ID must be a positive integer'),
  title: z.string().min(1, 'Title is required').max(255, 'Title too long'),
  message: z.string().min(1, 'Message is required').max(1000, 'Message too long'),
  type: z.string().min(1, 'Type is required'),
  metadata: z.record(z.string(), z.any()).optional().default({})
});

const notificationsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  type: z.string().optional(),
  isRead: z.string().optional()
});

// Helper function to log audit events
async function logAudit(userId: number, action: string, entityType: string, entityId?: number, details?: any) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId,
      details: details || {}
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

// POST /api/notifications - Create a new notification (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedData = createNotificationSchema.parse(req.body);
    
    // Verify the target user exists
    const targetUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, validatedData.userId))
      .limit(1);

    if (!targetUser.length) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }

    // Create the notification
    const newNotification = await db
      .insert(notifications)
      .values({
        userId: validatedData.userId,
        title: validatedData.title,
        message: validatedData.message,
        type: validatedData.type,
        metadata: validatedData.metadata
      })
      .returning();

    // Log audit
    await logAudit(
      req.user!.id,
      'NOTIFICATION_CREATED',
      'NOTIFICATION',
      newNotification[0].id,
      { targetUserId: validatedData.userId, type: validatedData.type }
    );

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: newNotification[0]
    });

  } catch (error) {
    console.error('Create notification error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create notification'
    });
  }
});

// GET /api/notifications - List all notifications (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedQuery = notificationsQuerySchema.parse(req.query);
    const page = parseInt(validatedQuery.page);
    const limit = Math.min(parseInt(validatedQuery.limit), 100);
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [];
    
    if (validatedQuery.type) {
      conditions.push(eq(notifications.type, validatedQuery.type));
    }
    
    if (validatedQuery.isRead) {
      const isRead = validatedQuery.isRead === 'true';
      conditions.push(eq(notifications.isRead, isRead));
    }

    // Get notifications with user details
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    const notificationsList = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        title: notifications.title,
        message: notifications.message,
        type: notifications.type,
        isRead: notifications.isRead,
        metadata: notifications.metadata,
        createdAt: notifications.createdAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        }
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.userId, users.id))
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const totalResult = await db
      .select({ count: sql`count(*)` })
      .from(notifications)
      .where(whereClause);
    
    const total = parseInt(totalResult[0].count as string);

    res.json({
      success: true,
      data: {
        notifications: notificationsList,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// GET /api/notifications/user/:id - List notifications by user
router.get('/user/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user can access these notifications (own notifications or admin)
    if (req.user!.role !== 'ADMIN' && req.user!.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const validatedQuery = notificationsQuerySchema.parse(req.query);
    const page = parseInt(validatedQuery.page);
    const limit = Math.min(parseInt(validatedQuery.limit), 100);
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [eq(notifications.userId, userId)];
    
    if (validatedQuery.type) {
      conditions.push(eq(notifications.type, validatedQuery.type));
    }
    
    if (validatedQuery.isRead) {
      const isRead = validatedQuery.isRead === 'true';
      conditions.push(eq(notifications.isRead, isRead));
    }

    // Get user notifications
    const userNotifications = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const totalResult = await db
      .select({ count: sql`count(*)` })
      .from(notifications)
      .where(and(...conditions));
    
    const total = parseInt(totalResult[0].count as string);

    // Get unread count
    const unreadResult = await db
      .select({ count: sql`count(*)` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
    
    const unreadCount = parseInt(unreadResult[0].count as string);

    res.json({
      success: true,
      data: {
        notifications: userNotifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get user notifications error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user notifications'
    });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', requireAuth, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.id);
    
    if (isNaN(notificationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID'
      });
    }

    // Get the notification to check ownership
    const notification = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);

    if (!notification.length) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user can mark this notification as read (owner or admin)
    if (req.user!.role !== 'ADMIN' && req.user!.id !== notification[0].userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Mark as read
    const updatedNotification = await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, notificationId))
      .returning();

    // Log audit
    await logAudit(
      req.user!.id,
      'NOTIFICATION_READ',
      'NOTIFICATION',
      notificationId
    );

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: updatedNotification[0]
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

export default router;
