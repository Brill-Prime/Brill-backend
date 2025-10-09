import express, { Request, Response } from 'express';
const router = express.Router();
router.put('/api/profile/privacy-settings', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented' });
});
export default router;
