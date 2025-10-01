
import express from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// GET /api/config/env-status - Check environment variables status
router.get('/env-status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const envStatus = {
      database: {
        url: !!process.env.DATABASE_URL,
        status: !!process.env.DATABASE_URL ? 'configured' : 'missing'
      },
      jwt: {
        secret: !!process.env.JWT_SECRET,
        status: !!process.env.JWT_SECRET ? 'configured' : 'missing'
      },
      email: {
        gmail: {
          user: !!process.env.GMAIL_USER,
          pass: !!process.env.GMAIL_PASS,
          status: (!!process.env.GMAIL_USER && !!process.env.GMAIL_PASS) ? 'configured' : 'missing'
        },
        smtp: {
          host: !!process.env.SMTP_HOST,
          user: !!process.env.SMTP_USER,
          pass: !!process.env.SMTP_PASS,
          status: (!!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS) ? 'configured' : 'missing'
        }
      },
      sms: {
        twilio: {
          accountSid: !!process.env.TWILIO_ACCOUNT_SID,
          authToken: !!process.env.TWILIO_AUTH_TOKEN,
          phoneNumber: !!process.env.TWILIO_PHONE_NUMBER,
          status: (!!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_PHONE_NUMBER) ? 'configured' : 'missing'
        }
      },
      payment: {
        paystack: {
          secretKey: !!process.env.PAYSTACK_SECRET_KEY,
          webhookSecret: !!process.env.PAYSTACK_WEBHOOK_SECRET,
          status: (!!process.env.PAYSTACK_SECRET_KEY && !!process.env.PAYSTACK_WEBHOOK_SECRET) ? 'configured' : 'missing'
        }
      },
      maps: {
        googleMaps: {
          apiKey: !!process.env.GOOGLE_MAPS_API_KEY,
          status: !!process.env.GOOGLE_MAPS_API_KEY ? 'configured' : 'missing'
        }
      }
    };

    res.json({
      success: true,
      data: envStatus
    });

  } catch (error) {
    console.error('Environment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check environment status'
    });
  }
});

// GET /api/config/app-info - Get application information
router.get('/app-info', async (req, res) => {
  try {
    const packageJson = require('../../package.json');
    
    res.json({
      success: true,
      data: {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('App info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch app information'
    });
  }
});

export default router;
