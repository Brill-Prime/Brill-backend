import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { tracking, orders, users, auditLogs } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createTrackingSchema = z.object({
  orderId: z.number().int().positive('Order ID must be a positive integer'),
  driverId: z.number().int().positive('Driver ID must be a positive integer').optional(),
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90').optional(),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180').optional(),
  status: z.string().min(1, 'Status is required'),
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

// POST /api/tracking - Create a new tracking entry
router.post('/', requireAuth, async (req, res) => {
  try {
    const trackingData = createTrackingSchema.parse(req.body);
    const user = req.user!;

    // Verify order exists
    const [order] = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        driverId: orders.driverId,
        status: orders.status
      })
      .from(orders)
      .where(eq(orders.id, trackingData.orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check permissions - only the assigned driver, customer, or admin can create tracking entries
    if (user.role !== 'ADMIN' && 
        user.id !== order.customerId && 
        user.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only track orders you are involved in.'
      });
    }

    // If driverId is provided, verify it matches the order's driver or user is admin
    if (trackingData.driverId) {
      if (user.role !== 'ADMIN' && trackingData.driverId !== order.driverId) {
        return res.status(403).json({
          success: false,
          message: 'Driver ID must match the order\'s assigned driver'
        });
      }

      // Verify the driver exists and has driver role
      const [driver] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, trackingData.driverId), eq(users.role, 'DRIVER')))
        .limit(1);

      if (!driver) {
        return res.status(400).json({
          success: false,
          message: 'Invalid driver ID or user is not a driver'
        });
      }
    }

    const [newTracking] = await db
      .insert(tracking)
      .values({
        orderId: trackingData.orderId,
        driverId: trackingData.driverId || order.driverId,
        latitude: trackingData.latitude ? trackingData.latitude.toString() : null,
        longitude: trackingData.longitude ? trackingData.longitude.toString() : null,
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
      { 
        orderId: trackingData.orderId, 
        status: trackingData.status, 
        hasLocation: !!(trackingData.latitude && trackingData.longitude)
      }
    );

    res.status(201).json({
      success: true,
      message: 'Tracking entry created successfully',
      tracking: {
        ...newTracking,
        latitude: newTracking.latitude ? parseFloat(newTracking.latitude) : null,
        longitude: newTracking.longitude ? parseFloat(newTracking.longitude) : null
      }
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

// GET /api/tracking/order/:id - List tracking entries by order
router.get('/order/:id', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Verify order exists and user has permission to view tracking
    const [order] = await db
      .select({
        id: orders.id,
        customerId: orders.customerId,
        driverId: orders.driverId,
        status: orders.status,
        orderNumber: orders.orderNumber
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check permissions - only the customer, assigned driver, or admin can view tracking
    if (user.role !== 'ADMIN' && 
        user.id !== order.customerId && 
        user.id !== order.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view tracking for orders you are involved in.'
      });
    }

    // Get tracking entries with driver information
    const trackingEntries = await db
      .select({
        id: tracking.id,
        orderId: tracking.orderId,
        driverId: tracking.driverId,
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

    // Convert latitude/longitude to numbers
    const formattedEntries = trackingEntries.map(entry => ({
      ...entry,
      latitude: entry.latitude ? parseFloat(entry.latitude) : null,
      longitude: entry.longitude ? parseFloat(entry.longitude) : null
    }));

    // Get latest tracking status
    const latestEntry = formattedEntries[0];

    res.json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status
      },
      latestStatus: latestEntry ? {
        status: latestEntry.status,
        timestamp: latestEntry.timestamp,
        location: latestEntry.latitude && latestEntry.longitude ? {
          latitude: latestEntry.latitude,
          longitude: latestEntry.longitude
        } : null
      } : null,
      trackingHistory: formattedEntries,
      totalEntries: formattedEntries.length
    });
  } catch (error) {
    console.error('Get tracking by order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve tracking entries'
    });
  }
});

// GET /api/tracking/driver/:id - List tracking entries by driver (Admin only)
router.get('/driver/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const { page = '1', limit = '20', startDate, endDate } = req.query;

    if (isNaN(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID'
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100);
    const offset = (pageNum - 1) * limitNum;

    // Verify driver exists
    const [driver] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        role: users.role
      })
      .from(users)
      .where(and(eq(users.id, driverId), eq(users.role, 'DRIVER')))
      .limit(1);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Build conditions
    const conditions = [eq(tracking.driverId, driverId)];

    if (startDate) {
      conditions.push(sql`${tracking.timestamp} >= ${new Date(startDate as string)}`);
    }

    if (endDate) {
      conditions.push(sql`${tracking.timestamp} <= ${new Date(endDate as string)}`);
    }

    // Get tracking entries with order information
    const trackingEntries = await db
      .select({
        id: tracking.id,
        orderId: tracking.orderId,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        timestamp: tracking.timestamp,
        createdAt: tracking.createdAt,
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status
        }
      })
      .from(tracking)
      .leftJoin(orders, eq(tracking.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(desc(tracking.timestamp))
      .limit(limitNum)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(tracking)
      .where(and(...conditions));

    // Format response
    const formattedEntries = trackingEntries.map(entry => ({
      ...entry,
      latitude: entry.latitude ? parseFloat(entry.latitude) : null,
      longitude: entry.longitude ? parseFloat(entry.longitude) : null
    }));

    res.json({
      success: true,
      driver,
      trackingHistory: formattedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('Get tracking by driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve driver tracking entries'
    });
  }
});

export default router;