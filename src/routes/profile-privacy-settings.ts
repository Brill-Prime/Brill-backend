import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { users, auditLogs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

const privacySettingsSchema = z.object({
  showEmail: z.boolean().default(false),
  showPhone: z.boolean().default(false),
  showLocation: z.boolean().default(true),
  allowMessages: z.boolean().default(true),
  allowNotifications: z.boolean().default(true),
  allowLocationTracking: z.boolean().default(true),
  shareDataWithPartners: z.boolean().default(false),
  twoFactorEnabled: z.boolean().default(false),
  sessionTimeout: z.number().min(5).max(1440).default(60)
});

// GET /api/profile/privacy-settings - Get privacy settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const privacySettings = (user?.metadata as any)?.privacySettings || {
      showEmail: false,
      showPhone: false,
      showLocation: true,
      allowMessages: true,
      allowNotifications: true,
      allowLocationTracking: true,
      shareDataWithPartners: false,
      twoFactorEnabled: user?.mfaEnabled || false,
      sessionTimeout: 60
    };

    res.json({
      success: true,
      data: privacySettings
    });
  } catch (error) {
    console.error('Get privacy settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to get privacy settings' });
  }
});

// PUT /api/profile/privacy-settings - Update privacy settings
router.put('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = privacySettingsSchema.partial().parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const currentSettings = (user?.metadata as any)?.privacySettings || {};
    const updatedSettings = {
      ...currentSettings,
      ...validatedData
    };

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), privacySettings: updatedSettings },
        mfaEnabled: validatedData.twoFactorEnabled ?? user?.mfaEnabled,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'PRIVACY_SETTINGS_UPDATED',
      entityType: 'USER',
      entityId: userId,
      details: { changes: Object.keys(validatedData) }
    });

    res.json({
      success: true,
      message: 'Privacy settings updated successfully',
      data: updatedSettings
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    console.error('Update privacy settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update privacy settings' });
  }
});

// DELETE /api/profile/privacy-settings - Reset to defaults
router.delete('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const defaultSettings = {
      showEmail: false,
      showPhone: false,
      showLocation: true,
      allowMessages: true,
      allowNotifications: true,
      allowLocationTracking: true,
      shareDataWithPartners: false,
      twoFactorEnabled: false,
      sessionTimeout: 60
    };

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), privacySettings: defaultSettings },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'PRIVACY_SETTINGS_RESET',
      entityType: 'USER',
      entityId: userId,
      details: {}
    });

    res.json({
      success: true,
      message: 'Privacy settings reset to defaults',
      data: defaultSettings
    });
  } catch (error) {
    console.error('Reset privacy settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset privacy settings' });
  }
});

export default router;