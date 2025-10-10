
import express from 'express';
import * as firebaseAdmin from '../config/firebase-admin';
import { db } from '../db/config';
import { sql } from 'drizzle-orm';

const router = express.Router();

// Lazy-load Firebase Database only if Firebase Admin is initialized
const getDb = () => {
  if (firebaseAdmin) {
    try {
      const { getDatabase } = require('firebase-admin/database');
      return getDatabase();
    } catch (error) {
      return null;
    }
  }
  return null;
};

// GET /api/health - Basic health check
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    const db = getDb();
    
    let dbStatus = 'not_configured';
    let dbResponseTime = 0;

    // Test database connection if Firebase is available
    if (db) {
      try {
        await db.ref().get();
        dbResponseTime = Date.now() - startTime;
        dbStatus = 'healthy';
      } catch (error) {
        dbStatus = 'error';
      }
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: {
          status: dbStatus,
          responseTime: dbResponseTime > 0 ? `${dbResponseTime}ms` : 'N/A'
        },
        memory: {
          usage: process.memoryUsage(),
          percentage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
        }
      }
    });

  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// GET /api/health/detailed - Detailed system status
router.get('/detailed', async (req, res) => {
  try {
    const checks: any = {
      postgres: { status: 'unknown', responseTime: 0 },
      firebase: { status: 'unknown' },
      email: { status: 'unknown', provider: 'none' },
      sms: { status: 'unknown' },
      payment: { status: 'unknown' },
      jwt: { status: 'unknown' }
    };

    // PostgreSQL Database check
    try {
      const startTime = Date.now();
      await db.execute(sql`SELECT 1 as health_check`);
      checks.postgres = {
        status: 'healthy',
        responseTime: `${Date.now() - startTime}ms`,
        connected: true
      };
    } catch (error) {
      console.error('PostgreSQL check failed:', error);
      checks.postgres = { status: 'error', connected: false };
    }

    // Firebase check
    try {
      const firebaseDb = getDb();
      if (firebaseDb) {
        await firebaseDb.ref().get();
        checks.firebase = { status: 'healthy', configured: true };
      } else {
        checks.firebase = { status: 'not_configured', configured: false };
      }
    } catch (error) {
      console.error('Firebase check failed:', error);
      checks.firebase = { status: 'error', configured: false };
    }

    // Email service check (check for Gmail OAuth integration first)
    if (process.env.REPL_PUBKEYS) {
      checks.email = { status: 'healthy', provider: 'gmail_oauth', configured: true };
    } else if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
      checks.email = { status: 'healthy', provider: 'gmail_smtp', configured: true };
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      checks.email = { status: 'healthy', provider: 'smtp', configured: true };
    } else {
      checks.email = { status: 'not_configured', provider: 'none', configured: false };
    }

    // SMS service check
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      checks.sms = { status: 'healthy', provider: 'twilio', configured: true };
    } else {
      checks.sms = { status: 'not_configured', provider: 'none', configured: false };
    }

    // Payment service check
    if (process.env.PAYSTACK_SECRET_KEY) {
      checks.payment = { status: 'healthy', provider: 'paystack', configured: true };
    } else {
      checks.payment = { status: 'not_configured', provider: 'none', configured: false };
    }

    // JWT secret check
    const jwtSecret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
    if (jwtSecret && jwtSecret !== 'default-development-secret-key') {
      checks.jwt = { status: 'healthy', configured: true };
    } else if (process.env.NODE_ENV === 'production') {
      checks.jwt = { status: 'error', configured: false, warning: 'Production requires JWT_SECRET' };
    } else {
      checks.jwt = { status: 'warning', configured: true, note: 'Using development secret' };
    }

    // Determine overall health
    const criticalServices = ['postgres', 'jwt'];
    const criticalHealthy = criticalServices.every(service => 
      checks[service]?.status === 'healthy' || checks[service]?.status === 'warning'
    );

    res.status(criticalHealthy ? 200 : 503).json({
      status: criticalHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      checks,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        nodeVersion: process.version
      }
    });

  } catch (error) {
    console.error('Detailed health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

export default router;
