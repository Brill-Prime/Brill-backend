
import express from 'express';
import { requireAuth, requireAdmin } from '../utils/auth';
import { realTimeAnalytics } from '../services/realtime-analytics';

const router = express.Router();

// Get system metrics
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const metrics = realTimeAnalytics.getCurrentMetrics();
    
    res.json({
      success: true,
      data: {
        ...metrics,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('System metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system metrics'
    });
  }
});

// Get detailed system health
router.get('/health', requireAuth, requireAdmin, async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const health = {
      status: 'healthy',
      uptime: {
        seconds: process.uptime(),
        formatted: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`
      },
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    };

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system health'
    });
  }
});

export default router;
