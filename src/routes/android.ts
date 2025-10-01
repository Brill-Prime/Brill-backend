

import express from 'express';
import { z } from 'zod';
import { MobileFirebaseService } from '../services/mobileFirebase';
import { requireAuth } from '../utils/auth';
import mobileConfig from '../config/mobile';

const router = express.Router();

// Android app configuration endpoint
router.get('/config', async (req, res) => {
  try {
    const config = {
      apiVersion: '1.0',
      firebase: {
        projectId: 'brillprime',
        applicationId: mobileConfig.android.applicationId,
        apiKey: mobileConfig.android.apiKey,
        projectNumber: mobileConfig.android.projectNumber,
        packageName: mobileConfig.android.packageName
      },
      endpoints: {
        base: process.env.API_BASE_URL || 'https://your-repl-name.replit.app',
        auth: '/api/firebase/auth',
        mobile: '/api/mobile',
        transactions: '/api/transactions',
        orders: '/api/orders'
      },
      features: mobileConfig.common.features,
      deepLinks: mobileConfig.android.deepLinks
    };
    
    res.json({
      success: true,
      config
    });
  } catch (error: any) {
    console.error('Android config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Android configuration'
    });
  }
});

// Android app version check
const versionSchema = z.object({
  versionName: z.string(),
  versionCode: z.number(),
  platform: z.literal('android')
});

router.post('/version-check', async (req, res) => {
  try {
    const validatedData = versionSchema.parse(req.body);
    
    // Check if app version is supported
    const minVersionCode = 1;
    const isSupported = validatedData.versionCode >= minVersionCode;
    
    res.json({
      success: true,
      supported: isSupported,
      minimumVersion: mobileConfig.common.supportedVersions.minimum,
      updateRequired: !isSupported,
      updateUrl: mobileConfig.android.playStoreId ? 
        `https://play.google.com/store/apps/details?id=${mobileConfig.android.packageName}` : null
    });
  } catch (error: any) {
    console.error('Android version check error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Invalid version data'
    });
  }
});

// Android FCM token registration
const fcmTokenSchema = z.object({
  token: z.string(),
  topics: z.array(z.string()).optional().default([])
});

router.post('/fcm-token', requireAuth, async (req, res) => {
  try {
    const validatedData = fcmTokenSchema.parse(req.body);
    const userId = req.session.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Save FCM token to Firebase
    await MobileFirebaseService.createMobileDocument(
      'fcmTokens',
      `android_${userId}`,
      {
        userId,
        platform: 'android',
        token: validatedData.token,
        topics: validatedData.topics,
        registeredAt: new Date(),
        active: true
      }
    );

    res.json({
      success: true,
      message: 'FCM token registered successfully'
    });
  } catch (error: any) {
    console.error('FCM token registration error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to register FCM token'
    });
  }
});

// Android intent handling for deep links
const intentSchema = z.object({
  action: z.string(),
  data: z.string().optional(),
  extras: z.record(z.string(), z.any()).optional()
});

router.post('/intent', requireAuth, async (req, res) => {
  try {
    const validatedData = intentSchema.parse(req.body);
    
    // Handle different intent actions
    let response: any = { success: true };
    
    switch (validatedData.action) {
      case 'VIEW_ORDER':
        response.redirect = `/orders/${validatedData.data}`;
        break;
      case 'VIEW_TRANSACTION':
        response.redirect = `/transactions/${validatedData.data}`;
        break;
      case 'DELIVERY_UPDATE':
        response.redirect = `/tracking/${validatedData.data}`;
        break;
      default:
        response.redirect = '/home';
    }
    
    res.json(response);
  } catch (error: any) {
    console.error('Intent handling error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to handle intent'
    });
  }
});

export default router;
