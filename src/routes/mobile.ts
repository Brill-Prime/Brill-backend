
import express from 'express';
import { z } from 'zod';
import { MobileFirebaseService } from '../services/mobileFirebase';
import { requireAuth } from '../utils/auth';
import mobileConfig from '../config/mobile';

const router = express.Router();

// Shared mobile configuration endpoint
router.get('/config', async (req, res) => {
  try {
    const config = {
      apiVersion: mobileConfig.common.apiVersion,
      supportedVersions: mobileConfig.common.supportedVersions,
      features: mobileConfig.common.features,
      pushNotifications: mobileConfig.pushNotifications,
      endpoints: {
        base: process.env.API_BASE_URL || 'https://your-repl-name.replit.app',
        auth: '/api/firebase/auth',
        mobile: '/api/mobile',
        ios: '/api/ios',
        android: '/api/android'
      }
    };
    
    res.json({
      success: true,
      config
    });
  } catch (error: any) {
    console.error('Mobile config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get mobile configuration'
    });
  }
});

// Validation schemas
const deviceInfoSchema = z.object({
  platform: z.enum(['ios', 'android']),
  version: z.string(),
  deviceId: z.string(),
  pushToken: z.string().optional()
});

const presenceSchema = z.object({
  isOnline: z.boolean()
});

// Mobile device registration
router.post('/device/register', requireAuth, async (req, res) => {
  try {
    const validatedData = deviceInfoSchema.parse(req.body);
    const userId = req.session.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Register device with Firebase
    await MobileFirebaseService.createMobileDocument(
      'devices',
      `${userId}_${validatedData.deviceId}`,
      {
        userId,
        ...validatedData,
        registeredAt: new Date()
      }
    );

    res.json({
      success: true,
      message: 'Device registered successfully'
    });
  } catch (error: any) {
    console.error('Device registration error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to register device'
    });
  }
});

// Update user presence for mobile
router.post('/presence', requireAuth, async (req, res) => {
  try {
    const validatedData = presenceSchema.parse(req.body);
    const userId = req.session.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    await MobileFirebaseService.setUserPresence(userId.toString(), validatedData.isOnline);

    res.json({
      success: true,
      message: 'Presence updated successfully'
    });
  } catch (error: any) {
    console.error('Presence update error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update presence'
    });
  }
});

// Enable offline support
router.post('/offline/enable', requireAuth, async (req, res) => {
  try {
    const result = await MobileFirebaseService.enableOfflineSupport();
    
    if (result) {
      res.json({
        success: true,
        message: 'Offline support enabled'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to enable offline support'
      });
    }
  } catch (error: any) {
    console.error('Enable offline error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to enable offline support'
    });
  }
});

// Disable offline support
router.post('/offline/disable', requireAuth, async (req, res) => {
  try {
    const result = await MobileFirebaseService.disableOfflineSupport();
    
    if (result) {
      res.json({
        success: true,
        message: 'Offline support disabled'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to disable offline support'
      });
    }
  } catch (error: any) {
    console.error('Disable offline error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to disable offline support'
    });
  }
});

// Mobile-specific error handling endpoint
router.post('/error/report', requireAuth, async (req, res) => {
  try {
    const errorData = req.body;
    const userId = req.session.user?.id;
    
    const errorReport = {
      userId,
      platform: errorData.platform,
      error: errorData.error,
      context: errorData.context,
      timestamp: new Date(),
      deviceInfo: errorData.deviceInfo
    };

    await MobileFirebaseService.createMobileDocument(
      'errorReports',
      `${userId}_${Date.now()}`,
      errorReport
    );

    res.json({
      success: true,
      message: 'Error report submitted successfully'
    });
  } catch (error: any) {
    console.error('Error reporting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit error report'
    });
  }
});

export default router;
