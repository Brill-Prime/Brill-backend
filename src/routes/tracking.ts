import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { tracking, orders, users, auditLogs } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createTrackingSchema = z.object({
  orderId: z.number().int().positive('Order ID must be a positive integer'),
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  status: z.string().min(1, 'Status is required'),
  timestamp: z.string().datetime().optional()
});

const updateTrackingSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  status: z.string().min(1).optional(),
  timestamp: z.string().datetime().optional()
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

// POST /api/tracking - Create tracking entry (Driver only)
router.post('/', requireAuth, requireRole(['DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const trackingData = createTrackingSchema.parse(req.body);
    const user = req.user!;

    // Verify the order exists and driver has access
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, trackingData.orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Only assigned driver or admin can create tracking entries
    if (user.role !== 'ADMIN' && order.driverId !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only track your assigned orders.'
      });
    }

    const [newTracking] = await db
      .insert(tracking)
      .values({
        orderId: trackingData.orderId,
        driverId: user.id,
        latitude: trackingData.latitude.toString(),
        longitude: trackingData.longitude.toString(),
        status: trackingData.status,
        timestamp: trackingData.timestamp ? new Date(trackingData.timestamp) : new Date()
      })
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'TRACKING_CREATED',
      'TRACKING',
      newTracking.id,
      { orderId: trackingData.orderId, status: trackingData.status }
    );

    res.status(201).json({
      success: true,
      message: 'Tracking entry created successfully',
      tracking: newTracking
    });
  } catch (error) {
    console.error('Create tracking error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create tracking entry'
    });
  }
});

// GET /api/tracking/order/:orderId - Get tracking for specific order
router.get('/order/:orderId', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const user = req.user!;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Verify the order exists and user has access
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

    // Only customer, assigned driver, merchant, or admin can view tracking
    if (user.role !== 'ADMIN' && 
        order.customerId !== user.id && 
        order.driverId !== user.id && 
        order.merchantId !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const trackingEntries = await db
      .select({
        id: tracking.id,
        orderId: tracking.orderId,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        timestamp: tracking.timestamp,
        createdAt: tracking.createdAt,
        driver: {
          id: users.id,
          fullName: users.fullName,
          phone: users.phone
        }
      })
      .from(tracking)
      .leftJoin(users, eq(tracking.driverId, users.id))
      .where(eq(tracking.orderId, orderId))
      .orderBy(desc(tracking.timestamp));

    res.json({
      success: true,
      tracking: trackingEntries
    });
  } catch (error) {
    console.error('Get tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve tracking information'
    });
  }
});

// GET /api/tracking/driver/:driverId - Get tracking entries by driver (Admin only)
router.get('/driver/:driverId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    const { page = '1', limit = '20', startDate, endDate } = req.query;

    if (isNaN(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID'
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [eq(tracking.driverId, driverId)];

    if (startDate) {
      conditions.push(sql`${tracking.timestamp} >= ${new Date(startDate as string)}`);
    }

    if (endDate) {
      conditions.push(sql`${tracking.timestamp} <= ${new Date(endDate as string)}`);
    }

    const whereCondition = and(...conditions);

    const trackingEntries = await db
      .select({
        id: tracking.id,
        orderId: tracking.orderId,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        timestamp: tracking.timestamp,
        createdAt: tracking.createdAt
      })
      .from(tracking)
      .where(whereCondition)
      .orderBy(desc(tracking.timestamp))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(tracking)
      .where(whereCondition);

    res.json({
      success: true,
      tracking: trackingEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('Get driver tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve driver tracking information'
    });
  }
});

// GET /api/tracking/:id - Get specific tracking entry
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const trackingId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(trackingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tracking ID'
      });
    }

    const [trackingEntry] = await db
      .select({
        id: tracking.id,
        orderId: tracking.orderId,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        timestamp: tracking.timestamp,
        createdAt: tracking.createdAt,
        driver: {
          id: users.id,
          fullName: users.fullName,
          phone: users.phone
        },
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          customerId: orders.customerId,
          merchantId: orders.merchantId,
          driverId: orders.driverId
        }
      })
      .from(tracking)
      .leftJoin(users, eq(tracking.driverId, users.id))
      .leftJoin(orders, eq(tracking.orderId, orders.id))
      .where(eq(tracking.id, trackingId))
      .limit(1);

    if (!trackingEntry) {
      return res.status(404).json({
        success: false,
        message: 'Tracking entry not found'
      });
    }

    // Check access permissions
    const order = trackingEntry.order;
    if (user.role !== 'ADMIN' && 
        order?.customerId !== user.id && 
        order?.driverId !== user.id && 
        order?.merchantId !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      tracking: trackingEntry
    });
  } catch (error) {
    console.error('Get tracking entry error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve tracking entry'
    });
  }
});

// PUT /api/tracking/:id - Update tracking entry (Driver only)
router.put('/:id', requireAuth, requireRole(['DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const trackingId = parseInt(req.params.id);
    const user = req.user!;
    const updateData = updateTrackingSchema.parse(req.body);

    if (isNaN(trackingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tracking ID'
      });
    }

    // Verify tracking entry exists and user has permission
    const [existingTracking] = await db
      .select({
        id: tracking.id,
        driverId: tracking.driverId,
        orderId: tracking.orderId
      })
      .from(tracking)
      .where(eq(tracking.id, trackingId))
      .limit(1);

    if (!existingTracking) {
      return res.status(404).json({
        success: false,
        message: 'Tracking entry not found'
      });
    }

    // Only the assigned driver or admin can update
    if (user.role !== 'ADMIN' && existingTracking.driverId !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own tracking entries.'
      });
    }

    const updatePayload: any = {};
    if (updateData.latitude) updatePayload.latitude = updateData.latitude.toString();
    if (updateData.longitude) updatePayload.longitude = updateData.longitude.toString();
    if (updateData.status) updatePayload.status = updateData.status;
    if (updateData.timestamp) updatePayload.timestamp = new Date(updateData.timestamp);

    const [updatedTracking] = await db
      .update(tracking)
      .set(updatePayload)
      .where(eq(tracking.id, trackingId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'TRACKING_UPDATED',
      'TRACKING',
      trackingId,
      { orderId: existingTracking.orderId, changes: updateData }
    );

    res.json({
      success: true,
      message: 'Tracking entry updated successfully',
      tracking: updatedTracking
    });
  } catch (error) {
    console.error('Update tracking error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update tracking entry'
    });
  }
});

// DELETE /api/tracking/:id - Delete tracking entry (Admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const trackingId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(trackingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tracking ID'
      });
    }

    const [existingTracking] = await db
      .select()
      .from(tracking)
      .where(eq(tracking.id, trackingId))
      .limit(1);

    if (!existingTracking) {
      return res.status(404).json({
        success: false,
        message: 'Tracking entry not found'
      });
    }

    await db
      .delete(tracking)
      .where(eq(tracking.id, trackingId));

    // Log audit activity
    await logAuditActivity(
      user.id,
      'TRACKING_DELETED',
      'TRACKING',
      trackingId,
      { orderId: existingTracking.orderId }
    );

    res.json({
      success: true,
      message: 'Tracking entry deleted successfully'
    });
  } catch (error) {
    console.error('Delete tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tracking entry'
    });
  }
});

export default router;
