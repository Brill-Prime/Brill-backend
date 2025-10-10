
import express from 'express';
import crypto from 'crypto';
import { db } from '../db/config';
import { users, auditLogs, trustedDevices } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

// Validation schemas
const registerBiometricSchema = z.object({
  biometricType: z.enum(['FINGERPRINT', 'FACE_ID', 'TOUCH_ID', 'IRIS']),
  deviceId: z.string().min(1),
  deviceName: z.string().optional(),
  publicKey: z.string().min(1) // For storing encrypted biometric template
});

const verifyBiometricSchema = z.object({
  biometricType: z.enum(['FINGERPRINT', 'FACE_ID', 'TOUCH_ID', 'IRIS']),
  deviceId: z.string().min(1),
  biometricData: z.string().min(1), // Encrypted biometric signature
  action: z.enum(['UNLOCK_DEVICE', 'VERIFY_PAYMENT', 'VERIFY_TRANSFER', 'VERIFY_PROFILE_CHANGE', 'VERIFY_ORDER']).optional()
});

// POST /api/biometric/register - Register biometric authentication for a device
router.post('/register', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const validatedData = registerBiometricSchema.parse(req.body);
    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create a hash of the public key for secure storage
    const biometricHash = crypto
      .createHash('sha256')
      .update(validatedData.publicKey + userId.toString())
      .digest('hex');

    // Update user with biometric data
    await db
      .update(users)
      .set({
        biometricHash: biometricHash,
        biometricType: validatedData.biometricType,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Check if device is already trusted
    const [existingDevice] = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceId, validatedData.deviceId),
          eq(trustedDevices.isActive, true),
          isNull(trustedDevices.deletedAt)
        )
      )
      .limit(1);

    // If device not trusted, create trusted device entry
    if (!existingDevice) {
      await db.insert(trustedDevices).values({
        userId: userId,
        deviceId: validatedData.deviceId,
        deviceName: validatedData.deviceName || 'Biometric Device',
        deviceType: 'MOBILE',
        isActive: true,
        lastUsed: new Date()
      });
    }

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: userId,
      action: 'BIOMETRIC_REGISTERED',
      entityType: 'USER',
      entityId: userId,
      details: {
        biometricType: validatedData.biometricType,
        deviceId: validatedData.deviceId
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Biometric authentication registered successfully',
      data: {
        biometricType: validatedData.biometricType,
        deviceId: validatedData.deviceId
      }
    });
  } catch (error) {
    console.error('Register biometric error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to register biometric authentication'
    });
  }
});

// POST /api/biometric/verify - Verify biometric authentication
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const validatedData = verifyBiometricSchema.parse(req.body);
    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Get user's biometric data
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!existingUser.biometricHash || !existingUser.biometricType) {
      return res.status(400).json({
        success: false,
        message: 'Biometric authentication not set up for this user'
      });
    }

    // Verify biometric type matches
    if (existingUser.biometricType !== validatedData.biometricType) {
      return res.status(400).json({
        success: false,
        message: 'Biometric type mismatch'
      });
    }

    // Verify the device is trusted
    const [device] = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceId, validatedData.deviceId),
          eq(trustedDevices.isActive, true),
          isNull(trustedDevices.deletedAt)
        )
      )
      .limit(1);

    if (!device) {
      return res.status(403).json({
        success: false,
        message: 'Device not trusted for biometric authentication'
      });
    }

    // Create verification hash from biometric data
    const verificationHash = crypto
      .createHash('sha256')
      .update(validatedData.biometricData + userId.toString())
      .digest('hex');

    // Compare hashes (in production, use more secure comparison)
    const isValid = verificationHash === existingUser.biometricHash;

    if (!isValid) {
      // Log failed attempt
      await db.insert(auditLogs).values({
        userId: userId,
        action: 'BIOMETRIC_VERIFICATION_FAILED',
        entityType: 'USER',
        entityId: userId,
        details: {
          biometricType: validatedData.biometricType,
          deviceId: validatedData.deviceId,
          action: validatedData.action || 'UNKNOWN'
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      return res.status(401).json({
        success: false,
        message: 'Biometric verification failed'
      });
    }

    // Update device last used
    await db
      .update(trustedDevices)
      .set({ lastUsed: new Date() })
      .where(eq(trustedDevices.id, device.id));

    // Log successful verification
    await db.insert(auditLogs).values({
      userId: userId,
      action: 'BIOMETRIC_VERIFICATION_SUCCESS',
      entityType: 'USER',
      entityId: userId,
      details: {
        biometricType: validatedData.biometricType,
        deviceId: validatedData.deviceId,
        action: validatedData.action || 'UNKNOWN'
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Biometric verification successful',
      data: {
        verified: true,
        action: validatedData.action || 'UNLOCK_DEVICE',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Verify biometric error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to verify biometric authentication'
    });
  }
});

// DELETE /api/biometric/remove - Remove biometric authentication
router.delete('/remove', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    // Remove biometric data
    await db
      .update(users)
      .set({
        biometricHash: null,
        biometricType: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: userId,
      action: 'BIOMETRIC_REMOVED',
      entityType: 'USER',
      entityId: userId,
      details: {},
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Biometric authentication removed successfully'
    });
  } catch (error) {
    console.error('Remove biometric error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove biometric authentication'
    });
  }
});

// GET /api/biometric/status - Get biometric authentication status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = typeof user.id === 'string' ? parseInt(user.id) : user.id;

    const [existingUser] = await db
      .select({
        biometricType: users.biometricType,
        hasBiometric: users.biometricHash
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        enabled: !!existingUser.hasBiometric,
        biometricType: existingUser.biometricType || null
      }
    });
  } catch (error) {
    console.error('Get biometric status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get biometric status'
    });
  }
});

export default router;
