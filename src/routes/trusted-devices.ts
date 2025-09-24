
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { trustedDevices, users, auditLogs } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import crypto from 'crypto';

const router = express.Router();

// Validation schemas
const registerDeviceSchema = z.object({
  deviceName: z.string().min(1, 'Device name is required'),
  deviceType: z.string().optional(),
  browserInfo: z.string().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional().default(30)
});

const updateDeviceSchema = z.object({
  deviceName: z.string().min(1).optional(),
  isActive: z.boolean().optional()
});

// Helper function to log audit actions
async function logAuditAction(userId: number, action: string, details: any = {}, req?: express.Request) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'TRUSTED_DEVICE',
      details: typeof details === 'object' ? details : { message: details },
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent']
    });
  } catch (error) {
    console.error('Failed to log audit action:', error);
  }
}

// Helper function to generate unique device ID
function generateDeviceId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/trusted-devices - Register a trusted device
router.post('/', requireAuth, async (req, res) => {
  try {
    const deviceData = registerDeviceSchema.parse(req.body);
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Generate unique device ID
    const deviceId = generateDeviceId();

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + deviceData.expiresInDays);

    // Create the trusted device
    const [newDevice] = await db
      .insert(trustedDevices)
      .values({
        userId,
        deviceId,
        deviceName: deviceData.deviceName,
        deviceType: deviceData.deviceType,
        browserInfo: deviceData.browserInfo || req.headers['user-agent'],
        expiresAt,
        lastUsedAt: new Date()
      })
      .returning();

    // Log the action
    await logAuditAction(
      userId,
      'TRUSTED_DEVICE_REGISTERED',
      {
        deviceId: newDevice.deviceId,
        deviceName: newDevice.deviceName,
        expiresAt: newDevice.expiresAt
      },
      req
    );

    res.status(201).json({
      success: true,
      message: 'Trusted device registered successfully',
      device: {
        id: newDevice.id,
        deviceId: newDevice.deviceId,
        deviceName: newDevice.deviceName,
        deviceType: newDevice.deviceType,
        browserInfo: newDevice.browserInfo,
        expiresAt: newDevice.expiresAt,
        isActive: newDevice.isActive,
        createdAt: newDevice.createdAt
      }
    });
  } catch (error) {
    console.error('Register trusted device error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to register trusted device'
    });
  }
});

// GET /api/trusted-devices - List all trusted devices for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Get all trusted devices for the user
    const devices = await db
      .select({
        id: trustedDevices.id,
        deviceId: trustedDevices.deviceId,
        deviceName: trustedDevices.deviceName,
        deviceType: trustedDevices.deviceType,
        browserInfo: trustedDevices.browserInfo,
        lastUsedAt: trustedDevices.lastUsedAt,
        expiresAt: trustedDevices.expiresAt,
        isActive: trustedDevices.isActive,
        createdAt: trustedDevices.createdAt
      })
      .from(trustedDevices)
      .where(and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.isActive, true)
      ))
      .orderBy(desc(trustedDevices.lastUsedAt));

    // Filter out expired devices and mark them as inactive
    const currentDate = new Date();
    const activeDevices = [];
    const expiredDeviceIds = [];

    for (const device of devices) {
      if (device.expiresAt && device.expiresAt < currentDate) {
        expiredDeviceIds.push(device.id);
      } else {
        activeDevices.push(device);
      }
    }

    // Mark expired devices as inactive
    if (expiredDeviceIds.length > 0) {
      await db
        .update(trustedDevices)
        .set({ isActive: false })
        .where(
          and(
            eq(trustedDevices.userId, userId),
            sql`${trustedDevices.id} = ANY(${expiredDeviceIds})`
          )
        );
    }

    // Log the action
    await logAuditAction(
      userId,
      'TRUSTED_DEVICES_LISTED',
      { deviceCount: activeDevices.length },
      req
    );

    res.json({
      success: true,
      devices: activeDevices,
      total: activeDevices.length
    });
  } catch (error) {
    console.error('List trusted devices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve trusted devices'
    });
  }
});

// GET /api/trusted-devices/:id - Get specific trusted device
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id);
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (isNaN(deviceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid device ID'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    const [device] = await db
      .select({
        id: trustedDevices.id,
        deviceId: trustedDevices.deviceId,
        deviceName: trustedDevices.deviceName,
        deviceType: trustedDevices.deviceType,
        browserInfo: trustedDevices.browserInfo,
        lastUsedAt: trustedDevices.lastUsedAt,
        expiresAt: trustedDevices.expiresAt,
        isActive: trustedDevices.isActive,
        createdAt: trustedDevices.createdAt
      })
      .from(trustedDevices)
      .where(and(
        eq(trustedDevices.id, deviceId),
        eq(trustedDevices.userId, userId)
      ))
      .limit(1);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Trusted device not found'
      });
    }

    res.json({
      success: true,
      device
    });
  } catch (error) {
    console.error('Get trusted device error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve trusted device'
    });
  }
});

// PUT /api/trusted-devices/:id - Update trusted device
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id);
    const updateData = updateDeviceSchema.parse(req.body);
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (isNaN(deviceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid device ID'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Check if device exists and belongs to user
    const [existingDevice] = await db
      .select()
      .from(trustedDevices)
      .where(and(
        eq(trustedDevices.id, deviceId),
        eq(trustedDevices.userId, userId)
      ))
      .limit(1);

    if (!existingDevice) {
      return res.status(404).json({
        success: false,
        message: 'Trusted device not found'
      });
    }

    // Update the device
    const [updatedDevice] = await db
      .update(trustedDevices)
      .set({
        ...updateData,
        lastUsedAt: new Date()
      })
      .where(and(
        eq(trustedDevices.id, deviceId),
        eq(trustedDevices.userId, userId)
      ))
      .returning();

    // Log the action
    await logAuditAction(
      userId,
      'TRUSTED_DEVICE_UPDATED',
      {
        deviceId: updatedDevice.deviceId,
        changes: updateData
      },
      req
    );

    res.json({
      success: true,
      message: 'Trusted device updated successfully',
      device: updatedDevice
    });
  } catch (error) {
    console.error('Update trusted device error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update trusted device'
    });
  }
});

// DELETE /api/trusted-devices/:id - Remove a trusted device
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deviceId = parseInt(req.params.id);
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (isNaN(deviceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid device ID'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Check if device exists and belongs to user
    const [existingDevice] = await db
      .select()
      .from(trustedDevices)
      .where(and(
        eq(trustedDevices.id, deviceId),
        eq(trustedDevices.userId, userId)
      ))
      .limit(1);

    if (!existingDevice) {
      return res.status(404).json({
        success: false,
        message: 'Trusted device not found'
      });
    }

    // Soft delete the device (mark as inactive)
    await db
      .update(trustedDevices)
      .set({
        isActive: false,
        deletedAt: new Date()
      })
      .where(and(
        eq(trustedDevices.id, deviceId),
        eq(trustedDevices.userId, userId)
      ));

    // Log the action
    await logAuditAction(
      userId,
      'TRUSTED_DEVICE_REMOVED',
      {
        deviceId: existingDevice.deviceId,
        deviceName: existingDevice.deviceName
      },
      req
    );

    res.json({
      success: true,
      message: 'Trusted device removed successfully'
    });
  } catch (error) {
    console.error('Remove trusted device error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove trusted device'
    });
  }
});

// DELETE /api/trusted-devices - Remove all trusted devices for the user
router.delete('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Get count of devices to be removed
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(trustedDevices)
      .where(and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.isActive, true)
      ));

    // Soft delete all active devices for the user
    await db
      .update(trustedDevices)
      .set({
        isActive: false,
        deletedAt: new Date()
      })
      .where(and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.isActive, true)
      ));

    // Log the action
    await logAuditAction(
      userId,
      'ALL_TRUSTED_DEVICES_REMOVED',
      { removedCount: parseInt(count as string) },
      req
    );

    res.json({
      success: true,
      message: `${count} trusted devices removed successfully`,
      removedCount: parseInt(count as string)
    });
  } catch (error) {
    console.error('Remove all trusted devices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove trusted devices'
    });
  }
});

export default router;
