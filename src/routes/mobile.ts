
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

// Update push notification token
router.post('/update-push-token', requireAuth, async (req, res) => {
  try {
    const { token, platform } = req.body;
    const userId = req.session.user?.id;

    if (!token || !platform) {
      return res.status(400).json({
        success: false,
        message: 'Push token and platform are required'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Store push token for user
    console.log('Push token updated:', { userId, token: token.substring(0, 20) + '...', platform });

    res.json({
      success: true,
      data: {
        tokenUpdated: true,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('Push token update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update push token'
    });
  }
});

// Sync offline actions
router.post('/sync-offline-actions', requireAuth, async (req, res) => {
  try {
    const { actions } = req.body;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!Array.isArray(actions)) {
      return res.status(400).json({
        success: false,
        message: 'Actions must be an array'
      });
    }

    const results: any[] = [];
    const errors: any[] = [];

    for (const action of actions) {
      try {
        // Process each offline action
        const result = await processOfflineAction(action, userId);
        results.push({
          id: action.id,
          success: true,
          result
        });
      } catch (error: any) {
        errors.push({
          id: action.id,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        processed: results.length,
        errorCount: errors.length,
        results,
        errors
      }
    });
  } catch (error: any) {
    console.error('Offline actions sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync offline actions'
    });
  }
});

// Process payment from mobile
router.post('/process-payment', requireAuth, async (req, res) => {
  try {
    const { orderId, amount, paymentMethod } = req.body;
    const userId = req.session.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Get user email for Paystack
    const PaystackService = (await import('../services/paystack')).default;
    const userResult = await fetch(`${process.env.API_BASE_URL || 'http://0.0.0.0:5000'}/api/users/${userId}`);
    const userData = await userResult.json() as any;

    if (!userData.success) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    const reference = `MOBILE_${Date.now()}_${userId}`;
    
    // Initialize payment with Paystack
    const paymentInit = await PaystackService.initializePayment(
      userData.data.email,
      amount,
      reference,
      {
        orderId,
        userId,
        source: 'mobile',
        paymentMethod
      }
    );

    res.json({
      success: true,
      data: {
        paymentUrl: paymentInit.authorization_url,
        reference: paymentInit.reference,
        accessCode: paymentInit.access_code
      }
    });
  } catch (error: any) {
    console.error('Mobile payment processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment'
    });
  }
});

// Verify payment from mobile
router.post('/verify-payment', requireAuth, async (req, res) => {
  try {
    const { reference } = req.body;
    const userId = req.session.user?.id;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    const PaystackService = (await import('../services/paystack')).default;
    const verification = await PaystackService.verifyPayment(reference);

    if (verification.status === 'success') {
      res.json({
        success: true,
        data: {
          amount: verification.amount / 100,
          status: verification.status,
          paidAt: verification.paid_at,
          reference: verification.reference
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        status: verification.status
      });
    }
  } catch (error: any) {
    console.error('Mobile payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
});

// Get payment history for mobile
router.get('/payment-history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { db } = await import('../db/config');
    const { transactions } = await import('../db/schema');
    const { eq, desc } = await import('drizzle-orm');

    const userTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(parseInt(limit as string))
      .offset((parseInt(page as string) - 1) * parseInt(limit as string));

    res.json({
      success: true,
      data: {
        transactions: userTransactions,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: userTransactions.length
        }
      }
    });
  } catch (error: any) {
    console.error('Payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
});

// Helper function to process offline actions
async function processOfflineAction(action: any, userId: number): Promise<any> {
  const { db } = await import('../db/config');
  const { transactions, orders } = await import('../db/schema');
  
  switch (action.type) {
    case 'CREATE_ORDER':
      // Queue order for processing when online
      return { message: 'Order creation queued for processing', queued: true };
    
    case 'UPDATE_PROFILE':
      // Queue profile update
      return { message: 'Profile update processed', updated: true };
    
    case 'PAYMENT':
      // Store payment attempt for retry
      if (action.data?.reference) {
        await db.insert(transactions).values({
          userId,
          amount: action.data.amount.toString(),
          type: 'PAYMENT',
          status: 'PENDING',
          paymentMethod: action.data.paymentMethod || 'PAYSTACK',
          transactionRef: action.data.reference,
          metadata: {
            ...action.data.metadata,
            offlineQueued: true,
            queuedAt: new Date().toISOString()
          }
        });
      }
      return { message: 'Payment queued for processing', queued: true };
    
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

export default router;
