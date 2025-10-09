import express, { Request, Response } from 'express';
const router = express.Router();
router.post('/api/calls', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented' });
});
router.get('/api/calls/:id', (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented' });
});
export default router;
