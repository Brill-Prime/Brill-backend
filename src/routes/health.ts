
import express from 'express';
import { getDatabase } from "firebase-admin/database";

const router = express.Router();
const db = getDatabase();

// GET /api/health - Basic health check
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();

    // Test database connection by reading the root
    await db.ref().get();
    const dbResponseTime = Date.now() - startTime;

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: {
          status: 'healthy',
          responseTime: `${dbResponseTime}ms`
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
      error: 'Database connection failed'
    });
  }
});

// GET /api/health/detailed - Detailed system status
router.get('/detailed', async (req, res) => {
  try {
    const checks = {
      database: false,
      email: false,
      sms: false,
      payment: false
    };

    // Database check
    try {
      await db.ref().get();
      checks.database = true;
    } catch (error) {
      console.error('Database check failed:', error);
    }

    // Email service check
    checks.email = !!(process.env.GMAIL_USER && process.env.GMAIL_PASS) ||
                   !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    // SMS service check
    checks.sms = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

    // Payment service check
    checks.payment = !!(process.env.PAYSTACK_SECRET_KEY);

    const allHealthy = Object.values(checks).every(check => check);

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
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
