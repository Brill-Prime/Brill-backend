import express, { Request, Response } from 'express';
const router = express.Router();
router.get('/api/admin/escrow-management', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented' });
});
export default router;
