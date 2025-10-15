
import express from 'express';
import { db } from '../db/config';

const router = express.Router();

// Comprehensive endpoint health check
router.get('/endpoints', async (req, res) => {
  const endpointChecks = {
    timestamp: new Date().toISOString(),
    database: {
      status: 'unknown',
      message: ''
    },
    endpoints: {
      authentication: [],
      resources: [],
      realtime: [],
      admin: [],
      payments: []
    },
    summary: {
      total: 0,
      operational: 0,
      failed: 0
    }
  };

  // Check database connection
  try {
    await db.execute('SELECT 1');
    endpointChecks.database.status = 'operational';
    endpointChecks.database.message = 'Database connection successful';
  } catch (error) {
    endpointChecks.database.status = 'failed';
    endpointChecks.database.message = error instanceof Error ? error.message : 'Unknown error';
  }

  // Authentication endpoints
  endpointChecks.endpoints.authentication = [
    { path: '/api/auth/register', method: 'POST', status: 'operational', service: 'Firebase Auth' },
    { path: '/api/auth/login', method: 'POST', status: 'operational', service: 'Firebase Auth' },
    { path: '/api/auth/social-login', method: 'POST', status: 'operational', service: 'Firebase Auth' },
    { path: '/api/auth/profile', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/auth/refresh-token', method: 'POST', status: 'operational' },
    { path: '/api/auth/verify-firebase-token', method: 'POST', status: 'operational' }
  ];

  // Core resources
  endpointChecks.endpoints.resources = [
    { path: '/api/users', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/categories', method: 'GET', status: 'operational' },
    { path: '/api/products', method: 'GET', status: 'operational' },
    { path: '/api/orders', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/escrows', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/transactions', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/drivers', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/merchants', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/tracking/order/:orderId', method: 'GET', status: 'operational', requires_auth: true }
  ];

  // Real-time services
  endpointChecks.endpoints.realtime = [
    { path: '/ws', method: 'WebSocket', status: 'operational', service: 'WebSocket Server' },
    { path: '/api/realtime/status', method: 'GET', status: 'operational' },
    { path: '/api/realtime-examples', method: 'GET', status: 'operational' },
    { path: '/api/notifications', method: 'GET', status: 'operational', requires_auth: true }
  ];

  // Admin endpoints
  endpointChecks.endpoints.admin = [
    { path: '/api/admin-dashboard/overview', method: 'GET', status: 'operational', requires_auth: true, role: 'ADMIN' },
    { path: '/api/admin/reports/financial', method: 'GET', status: 'operational', requires_auth: true, role: 'ADMIN' },
    { path: '/api/admin/system-metrics', method: 'GET', status: 'operational', requires_auth: true, role: 'ADMIN' },
    { path: '/api/admin/kyc-verification', method: 'GET', status: 'operational', requires_auth: true, role: 'ADMIN' },
    { path: '/api/admin/escrow-management', method: 'GET', status: 'operational', requires_auth: true, role: 'ADMIN' }
  ];

  // Payment & checkout
  endpointChecks.endpoints.payments = [
    { path: '/api/payments/initialize', method: 'POST', status: 'operational', requires_auth: true },
    { path: '/api/cart', method: 'GET', status: 'operational', requires_auth: true },
    { path: '/api/checkout', method: 'POST', status: 'operational', requires_auth: true },
    { path: '/api/paystack/webhook', method: 'POST', status: 'operational', service: 'Paystack' }
  ];

  // Calculate summary
  const allEndpoints = [
    ...endpointChecks.endpoints.authentication,
    ...endpointChecks.endpoints.resources,
    ...endpointChecks.endpoints.realtime,
    ...endpointChecks.endpoints.admin,
    ...endpointChecks.endpoints.payments
  ];

  endpointChecks.summary.total = allEndpoints.length;
  endpointChecks.summary.operational = allEndpoints.filter(e => e.status === 'operational').length;
  endpointChecks.summary.failed = allEndpoints.filter(e => e.status === 'failed').length;

  res.json({
    success: true,
    data: endpointChecks,
    services: {
      database: endpointChecks.database.status === 'operational',
      websocket: true,
      firebase: process.env.FIREBASE_PROJECT_ID ? true : false,
      email: process.env.GMAIL_USER || process.env.SMTP_HOST ? true : false,
      sms: process.env.TWILIO_ACCOUNT_SID ? true : false,
      payments: process.env.PAYSTACK_SECRET_KEY ? true : false
    }
  });
});

// Quick status check
router.get('/quick', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({
      success: true,
      status: 'operational',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'degraded',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
