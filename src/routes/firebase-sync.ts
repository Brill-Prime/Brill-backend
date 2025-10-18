import { Router, Request, Response } from 'express';
import { firebaseSyncService, runManualFirebaseSync } from '../services/firebase-sync';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = Router();

router.post('/sync/manual', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {

    await runManualFirebaseSync();

    res.json({
      success: true,
      message: 'Manual Firebase sync completed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error in manual Firebase sync:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete manual sync',
      error: error.message
    });
  }
});

router.get('/sync/status', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {

    res.json({
      success: true,
      status: 'active',
      message: 'Firebase sync service is running',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error checking sync status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check sync status',
      error: error.message
    });
  }
});

export default router;
