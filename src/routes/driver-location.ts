
import { Router } from 'express';
import { db } from '../db/config';
import { eq } from 'drizzle-orm';

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  next();
};

// Get current driver location
router.get('/current', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    // Mock location data - replace with actual database query
    const location = {
      lat: 6.5244,
      lng: 3.3792,
      address: 'Lagos, Nigeria',
      lastUpdate: new Date().toISOString(),
      isAvailable: true,
      vehicleType: 'motorcycle',
      rating: 4.8
    };

    res.json({
      success: true,
      location
    });
  } catch (error) {
    console.error('Error fetching driver location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch location'
    });
  }
});

// Update driver location
router.post('/update', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { latitude, longitude, heading, speed, accuracy } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    const now = new Date();
    
    // Create location object as a proper JSON object
    const locationData = JSON.stringify({
      latitude,
      longitude,
      heading,
      speed,
      accuracy,
      timestamp: now.toISOString()
    });

    // Update driver's current location in the database
    try {
      const { driverProfiles } = await import('../db/schema');
      await db.update(driverProfiles)
        .set({ 
          currentLocation: locationData,
          updatedAt: now
        })
        .where(eq(driverProfiles.userId, userId));
    } catch (dbError) {
      console.error('Database update error:', dbError);
      // Continue execution even if database update fails
    }

    // Broadcast real-time location update via WebSocket if available
    if ((global as any).io) {
      const locationUpdate = {
        driverId: userId,
        latitude,
        longitude,
        heading,
        speed,
        accuracy,
        timestamp: now.getTime()
      };

      (global as any).io.to(`driver_${userId}`).emit('location_update_confirmed', locationUpdate);
      (global as any).io.to('admin_monitoring').emit('driver_location_update', locationUpdate);
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      location: {
        latitude,
        longitude,
        heading,
        speed,
        accuracy,
        timestamp: now.toISOString()
      }
    });
  } catch (error) {
    console.error('Error updating driver location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
});

export default router;
