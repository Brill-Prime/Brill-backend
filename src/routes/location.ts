
import express from 'express';
import { requireAuth } from '../utils/auth';
import { realtimeDb } from '../services/realtime-database';
import { z } from 'zod';

const router = express.Router();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timestamp: z.number().optional()
});

// PUT /api/location/live - Update live location
router.put('/live', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validation = locationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors
      });
    }

    const { latitude, longitude, timestamp } = validation.data;
    const locationData = {
      latitude,
      longitude,
      timestamp: timestamp || Date.now(),
      updatedAt: new Date().toISOString()
    };

    await realtimeDb.ref(`locations/users/${userId}`).set(locationData);

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: locationData
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ success: false, message: 'Failed to update location' });
  }
});

// GET /api/location/live/:userId - Get live location of user
router.get('/live/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const snapshot = await realtimeDb.ref(`locations/users/${userId}`).once('value');
    const locationData = snapshot.val();

    if (!locationData) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    res.json({
      success: true,
      data: locationData
    });
  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({ success: false, message: 'Failed to get location' });
  }
});

export default router;
