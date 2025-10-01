
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { notifications, users, auditLogs } from '../db/schema';
import { eq, and, desc, isNull, or, ilike } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const sendNotificationSchema = z.object({
  userId: z.number().int().positive().optional(),
  title: z.string().min(1, 'Title is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['INFO', 'WARNING', 'ERROR', 'SUCCESS']).default('INFO'),
  data: z.record(z.string(), z.any()).optional(),
  broadcast: z.boolean().default(false)
});

const bulkNotificationSchema = z.object({
  userIds: z.array(z.number().int().positive()),
  title: z.string().min(1),
  message: z.string().min(1),
  type: z.enum(['INFO', 'WARNING', 'ERROR', 'SUCCESS']).default('INFO'),
  data: z.record(z.string(), z.any()).optional()
});

// POST /api/push-notifications/send - Send push notification
router.post('/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedData = sendNotificationSchema.parse(req.body);
    const adminId = req.user!.id;

    if (validatedData.broadcast) {
      // Send to all active users
      const activeUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.isActive, true),
          isNull(users.deletedAt)
        ));

      const notificationValues = activeUsers.map(user => ({
        userId: user.id,
        title: validatedData.title,
        message: validatedData.message,
        type: validatedData.type,
        isRead: false
      }));

      await db.insert(notifications).values(notificationValues);

      res.json({
        success: true,
        message: `Broadcast notification sent to ${activeUsers.length} users`
      });
    } else if (validatedData.userId) {
      // Send to specific user
      const [notification] = await db
        .insert(notifications)
        .values({
          userId: validatedData.userId,
          title: validatedData.title,
          message: validatedData.message,
          type: validatedData.type,
          isRead: false
        })
        .returning();

      res.json({
        success: true,
        message: 'Notification sent successfully',
        data: notification
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either userId or broadcast must be specified'
      });
    }

    // Log audit event
    await db.insert(auditLogs).values({
      userId: adminId,
      action: 'PUSH_NOTIFICATION_SENT',
      entityType: 'NOTIFICATION',
      details: {
        title: validatedData.title,
        broadcast: validatedData.broadcast,
        targetUserId: validatedData.userId
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

  } catch (error) {
    console.error('Send notification error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send notification'
    });
  }
});

// POST /api/push-notifications/bulk - Send bulk notifications
router.post('/bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedData = bulkNotificationSchema.parse(req.body);

    const notificationData = validatedData.userIds.map(userId => ({
      userId,
      title: validatedData.title,
      message: validatedData.message,
      type: validatedData.type,
      data: validatedData.data || {},
      isRead: false
    }));

    await db.insert(notifications).values(notificationData);

    res.json({
      success: true,
      message: `Bulk notification sent to ${validatedData.userIds.length} users`
    });

  } catch (error) {
    console.error('Bulk notification error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk notifications'
    });
  }
});

export default router;
