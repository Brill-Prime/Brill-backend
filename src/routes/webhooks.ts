
import express from 'express';
import PaystackService from '../services/paystack';

const router = express.Router();

// Paystack webhook endpoint
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    const payload = req.body.toString();

    // Verify webhook signature
    if (!PaystackService.verifyWebhookSignature(payload, signature)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }

    // Parse webhook event
    const event = JSON.parse(payload);
    
    // Process the webhook event
    await PaystackService.processWebhookEvent(event);

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process webhook'
    });
  }
});

// Generic webhook health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook service is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router;
