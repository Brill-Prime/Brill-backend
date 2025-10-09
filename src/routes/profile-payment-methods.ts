import express, { Request, Response } from 'express';
const router = express.Router();
router.get('/api/profile/payment-methods', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented' });
});
router.put('/api/profile/payment-methods', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented' });
});
export default router;
