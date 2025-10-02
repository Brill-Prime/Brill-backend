
import express from 'express';
import { db } from '../db/config';

const router = express.Router();

// Mobile app health check endpoint
router.get('/mobile/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        api: 'operational',
        redis: process.env.REDIS_DISABLED ? 'disabled' : 'operational',
      },
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      mobile: {
        supportedPlatforms: ['ios', 'android'],
        apiCompatibility: 'v1',
        features: {
          offline: true,
          realtime: true,
          pushNotifications: true,
        },
      },
    };

    res.json({
      success: true,
      data: healthData,
    });
  } catch (error) {
    console.error('Mobile health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Service unhealthy',
      timestamp: new Date().toISOString(),
    });
  }
});

// Mobile app configuration endpoint
router.get('/mobile/config', async (req, res) => {
  try {
    const config = {
      apiVersion: '1.0.0',
      baseUrl: process.env.NODE_ENV === 'production' 
        ? 'https://brillprime-monorepo.replit.app/api'
        : 'http://0.0.0.0:5000/api',
      features: {
        qrScanner: true,
        biometricAuth: true,
        pushNotifications: true,
        fuelOrdering: true,
        tollPayments: true,
        realTimeTracking: true,
        offlineMode: true,
      },
      limits: {
        maxFileUploadSize: 10 * 1024 * 1024, // 10MB
        maxCartItems: 50,
        maxTransferAmount: 1000000, // ₦1,000,000
      },
      endpoints: {
        websocket: process.env.WEBSOCKET_URL || (process.env.NODE_ENV === 'production' 
          ? 'wss://brillprime-monorepo.replit.app' 
          : 'ws://0.0.0.0:5000'),
        payments: {
          paystack: !!process.env.PAYSTACK_PUBLIC_KEY,
          stripe: !!process.env.STRIPE_PUBLIC_KEY,
        },
      },
    };

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Mobile config error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load configuration',
    });
  }
});

// Mobile database integration verification
router.get('/mobile/database-status', async (req, res) => {
  try {
    const userCount: any = await db.execute('SELECT COUNT(*) as count FROM users');
    const orderCount: any = await db.execute('SELECT COUNT(*) as count FROM orders');
    const transactionCount: any = await db.execute('SELECT COUNT(*) as count FROM transactions');
    const productCount: any = await db.execute('SELECT COUNT(*) as count FROM products');

    const dbStatus = {
      connected: true,
      sharedWithWebApp: true,
      tables: {
        users: userCount.rows?.[0]?.count || 0,
        orders: orderCount.rows?.[0]?.count || 0,
        transactions: transactionCount.rows?.[0]?.count || 0,
        products: productCount.rows?.[0]?.count || 0
      },
      schemaVersion: '1.0.0',
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: dbStatus
    });
  } catch (error) {
    console.error('Mobile database status error:', error);
    res.status(500).json({
      success: false,
      error: 'Database connection failed',
      connected: false
    });
  }
});

export default router;
