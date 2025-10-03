
import { Router } from 'express';
import { db } from '../db/config';
import { orders } from '../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';
import crypto from 'crypto';

const router = Router();

// Generate QR code data for order
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { orderId } = z.object({
      orderId: z.number().int().positive()
    }).parse(req.body);

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Generate QR data (encrypted order info)
    const qrData = {
      orderId: order.id,
      timestamp: Date.now(),
      hash: crypto.createHash('sha256')
        .update(`${order.id}-${order.customerId}-${Date.now()}`)
        .digest('hex')
    };

    res.json({
      success: true,
      qrData: Buffer.from(JSON.stringify(qrData)).toString('base64')
    });
  } catch (error: any) {
    console.error('QR generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate QR code'
    });
  }
});

// Verify QR code
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { qrData } = z.object({
      qrData: z.string()
    }).parse(req.body);

    const decoded = JSON.parse(Buffer.from(qrData, 'base64').toString());

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, decoded.orderId))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code'
      });
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount
      }
    });
  } catch (error: any) {
    console.error('QR verification error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid QR code format'
    });
  }
});

// QR Code scanning endpoint
router.post('/scan', async (req, res) => {
  try {
    const { qrCode, type } = req.body;

    if (!qrCode || !type) {
      return res.status(400).json({
        success: false,
        message: 'QR code and type are required'
      });
    }

    let result;

    switch (type) {
      case 'delivery':
        result = await processDeliveryQR(qrCode);
        break;
      case 'payment':
        result = await processPaymentQR(qrCode);
        break;
      case 'toll':
        result = await processTollQR(qrCode);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid QR code type'
        });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('QR scanning error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process QR code'
    });
  }
});

async function processDeliveryQR(qrCode: string) {
  return {
    type: 'delivery',
    orderId: qrCode,
    status: 'verified',
    timestamp: new Date().toISOString()
  };
}

async function processPaymentQR(qrCode: string) {
  return {
    type: 'payment',
    amount: 0,
    reference: qrCode,
    status: 'pending'
  };
}

async function processTollQR(qrCode: string) {
  return {
    type: 'toll',
    gateId: qrCode,
    status: 'ready',
    timestamp: new Date().toISOString()
  };
}

export default router;
