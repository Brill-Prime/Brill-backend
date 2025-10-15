import express from 'express';

const router = express.Router();

// Wallet functionality has been removed in favor of direct payment processing
// All wallet endpoints return 410 Gone status
router.all('*', (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Wallet functionality has been removed. Please use direct payment methods via /api/payments',
    code: 'WALLET_DEPRECATED'
  });
});

export default router;