
import express from 'express';
import { z } from 'zod';
import { MobileFirebaseService } from '../services/mobileFirebase';
import { requireAuth } from '../utils/auth';
import iosConfig from '../config/ios';

const router = express.Router();

// iOS app configuration endpoint
router.get('/config', async (req, res) => {
  try {
    const config = {
      apiVersion: '1.0',
      endpoints: iosConfig.apiEndpoints,
      features: iosConfig.features,
      firebase: {
        bundleId: iosConfig.firebase.bundleId,
        pushNotifications: iosConfig.firebase.pushNotifications
      }
    };
    
    res.json({
      success: true,
      config
    });
  } catch (error: any) {
    console.error('iOS config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get iOS configuration'
    });
  }
});

// iOS app version check
const versionSchema = z.object({
  version: z.string(),
  build: z.string(),
  platform: z.literal('ios')
});

router.post('/version-check', async (req, res) => {
  try {
    const validatedData = versionSchema.parse(req.body);
    
    // Check if app version is supported
    const minVersion = '1.0.0';
    const isSupported = validatedData.version >= minVersion;
    
    res.json({
      success: true,
      supported: isSupported,
      minimumVersion: minVersion,
      updateRequired: !isSupported,
      updateUrl: iosConfig.firebase.appStoreId ? 
        `https://apps.apple.com/app/id${iosConfig.firebase.appStoreId}` : null
    });
  } catch (error: any) {
    console.error('iOS version check error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Invalid version data'
    });
  }
});

// iOS push token registration
const pushTokenSchema = z.object({
  token: z.string(),
  sandbox: z.boolean().optional().default(false)
});

router.post('/push-token', requireAuth, async (req, res) => {
  try {
    const validatedData = pushTokenSchema.parse(req.body);
    const userId = req.session.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Save push token to Firebase
    await MobileFirebaseService.createMobileDocument(
      'pushTokens',
      `ios_${userId}`,
      {
        userId,
        platform: 'ios',
        token: validatedData.token,
        sandbox: validatedData.sandbox,
        registeredAt: new Date(),
        active: true
      }
    );

    res.json({
      success: true,
      message: 'Push token registered successfully'
    });
  } catch (error: any) {
    console.error('Push token registration error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to register push token'
    });
  }
});

export default router;
