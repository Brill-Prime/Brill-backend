import express from 'express';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// GET /api/config/app - Get app configuration
router.get('/app', async (req, res) => {
  res.json({
    success: true,
    config: {
      appName: 'BrillPrime',
      version: '1.0.0',
      supportedPaymentMethods: ['CARD', 'WALLET', 'BANK_TRANSFER'],
      supportedAuthMethods: ['EMAIL', 'GOOGLE', 'FACEBOOK', 'APPLE'],
      features: {
        realTimeTracking: true,
        qrCodePayment: true,
        escrowPayment: true,
        fuelDelivery: true,
        chatSupport: true
      }
    }
  });
});

// GET /api/config/payment - Get payment configuration
router.get('/payment', requireAuth, async (req, res) => {
  res.json({
    success: true,
    config: {
      paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY,
      supportedCurrencies: ['NGN'],
      escrowSettings: {
        autoReleaseEnabled: true,
        autoReleaseDays: 2,
        disputeWindowDays: 7
      }
    }
  });
});

// GET /api/config/delivery - Get delivery configuration
router.get('/delivery', async (req, res) => {
  res.json({
    success: true,
    config: {
      maxDeliveryRadius: 50, // km
      averageDeliveryTime: 45, // minutes
      deliveryFeePerKm: 50, // NGN
      minimumDeliveryFee: 500 // NGN
    }
  });
});

// PUT /api/config/app - Update app configuration (admin only)
router.put('/app', requireAuth, requireAdmin, async (req, res) => {
  try {
    // In a real app, this would update the database
    res.json({
      success: true,
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update configuration'
    });
  }
});

export default router;