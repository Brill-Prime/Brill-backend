
import express from 'express';
import { db } from '../db/config';
import { driverProfiles, tracking, users } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { adminRealtimeDb } from '../config/firebase-admin';
import { z } from 'zod';

const router = express.Router();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timestamp: z.number().optional(),
  orderId: z.number().int().positive().optional()
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

    const { latitude, longitude, timestamp, orderId } = validation.data;
    const locationData = {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      timestamp: timestamp || Date.now(),
      updatedAt: new Date().toISOString(),
      userId
    };

    // Update Firebase Realtime Database
    if (adminRealtimeDb) {
      await adminRealtimeDb.ref(`locations/users/${userId}`).set(locationData);
    }

    // Update driver profile if user is a driver
    const [driver] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, userId))
      .limit(1);

    if (driver) {
      await db
        .update(driverProfiles)
        .set({
          currentLocation: { latitude, longitude, timestamp: new Date().toISOString() }
        })
        .where(eq(driverProfiles.userId, userId));
    }

    // Create tracking record if orderId is provided
    if (orderId) {
      await db
        .insert(tracking)
        .values({
          orderId,
          driverId: userId,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          status: 'IN_TRANSIT'
        });
    }

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
    const targetUserId = parseInt(req.params.userId);

    if (isNaN(targetUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    let locationData = null;

    // Try Firebase Realtime Database first
    if (adminRealtimeDb) {
      const snapshot = await adminRealtimeDb.ref(`locations/users/${targetUserId}`).once('value');
      locationData = snapshot.val();
    }

    // Fallback to driver profile location
    if (!locationData) {
      const [driver] = await db
        .select()
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, targetUserId))
        .limit(1);

      if (driver?.currentLocation) {
        locationData = driver.currentLocation;
      }
    }

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

// GET /api/location/tracking/:orderId - Get location tracking history for an order
router.get('/tracking/:orderId', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);

    if (isNaN(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const trackingHistory = await db
      .select({
        id: tracking.id,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        createdAt: tracking.createdAt,
        driver: {
          id: users.id,
          fullName: users.fullName,
          profilePicture: users.profilePicture
        }
      })
      .from(tracking)
      .leftJoin(users, eq(tracking.driverId, users.id))
      .where(eq(tracking.orderId, orderId))
      .orderBy(desc(tracking.createdAt));

    res.json({
      success: true,
      data: trackingHistory
    });
  } catch (error) {
    console.error('Get tracking history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get tracking history' });
  }
});

export default router;
