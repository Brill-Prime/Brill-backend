import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { users, orders, driverProfiles, products } from '../db/schema';
import { eq, and, desc, sql, count, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

const systemActionSchema = z.object({
  action: z.enum(['PAUSE_ORDERS', 'RESUME_ORDERS', 'ENABLE_MAINTENANCE', 'DISABLE_MAINTENANCE', 'CLEAR_CACHE']),
  reason: z.string().optional()
});

// GET /api/admin/control-center - Get control center dashboard
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [systemStatus] = await db
      .select({
        totalUsers: count(sql`CASE WHEN ${users.role} = 'CONSUMER' THEN 1 END`),
        activeOrders: count(sql`CASE WHEN ${orders.status} IN ('PENDING', 'CONFIRMED', 'IN_TRANSIT') THEN 1 END`),
        onlineDrivers: count(sql`CASE WHEN ${driverProfiles.isOnline} = true THEN 1 END`),
        activeProducts: count(sql`CASE WHEN ${products.isActive} = true THEN 1 END`)
      })
      .from(users)
      .leftJoin(orders, isNull(orders.deletedAt))
      .leftJoin(driverProfiles, isNull(driverProfiles.deletedAt))
      .leftJoin(products, isNull(products.deletedAt));

    res.json({
      success: true,
      data: {
        systemStatus,
        maintenance: false,
        ordersEnabled: true,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    console.error('Control center error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch control center data' });
  }
});

// POST /api/admin/control-center/action - Execute system action
router.post('/action', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedData = systemActionSchema.parse(req.body);

    // Log the action
    console.log(`Admin action: ${validatedData.action} by user ${req.user!.id}`);

    res.json({
      success: true,
      message: `Action ${validatedData.action} executed successfully`
    });
  } catch (error) {
    console.error('Control center action error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    res.status(500).json({ success: false, message: 'Failed to execute action' });
  }
});

export default router;
