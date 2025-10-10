
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { tracking, orders, users, driverProfiles } from '../db/schema';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import GeolocationService from '../services/geolocation';

const router = express.Router();

// GET /api/map/order/:orderId - Get live map data for order tracking
router.get('/order/:orderId', requireAuth, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const user = req.user!;

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Get order details
    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        customerId: orders.customerId,
        merchantId: orders.merchantId,
        driverId: orders.driverId,
        pickupAddress: orders.pickupAddress,
        pickupLatitude: orders.pickupLatitude,
        pickupLongitude: orders.pickupLongitude,
        deliveryAddress: orders.deliveryAddress,
        deliveryLatitude: orders.deliveryLatitude,
        deliveryLongitude: orders.deliveryLongitude
      })
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify access
    const hasAccess = 
      order.customerId === user.id ||
      order.merchantId === user.id ||
      order.driverId === user.id ||
      user.role === 'ADMIN';

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get latest tracking points
    const trackingPoints = await db
      .select({
        id: tracking.id,
        latitude: tracking.latitude,
        longitude: tracking.longitude,
        status: tracking.status,
        timestamp: tracking.timestamp
      })
      .from(tracking)
      .where(eq(tracking.orderId, orderId))
      .orderBy(desc(tracking.timestamp))
      .limit(100);

    // Get driver current location
    let driverLocation = null;
    if (order.driverId) {
      const [driver] = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          phone: users.phone,
          currentLatitude: driverProfiles.currentLatitude,
          currentLongitude: driverProfiles.currentLongitude,
          isAvailable: driverProfiles.isAvailable
        })
        .from(users)
        .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
        .where(eq(users.id, order.driverId))
        .limit(1);

      if (driver && driver.currentLatitude && driver.currentLongitude) {
        driverLocation = {
          id: driver.id,
          name: driver.fullName,
          phone: driver.phone,
          latitude: parseFloat(driver.currentLatitude),
          longitude: parseFloat(driver.currentLongitude),
          isAvailable: driver.isAvailable
        };
      }
    }

    // Calculate ETA if driver location is available
    let eta = null;
    if (driverLocation && order.deliveryLatitude && order.deliveryLongitude) {
      const distance = await GeolocationService.calculateDistance(
        { latitude: parseFloat(driverLocation.latitude), longitude: parseFloat(driverLocation.longitude) },
        { latitude: parseFloat(order.deliveryLatitude), longitude: parseFloat(order.deliveryLongitude) },
        'driving'
      );

      if (distance) {
        eta = {
          distance: distance.distance,
          duration: distance.duration,
          estimatedArrival: new Date(Date.now() + distance.duration * 60000).toISOString()
        };
      }
    }

    res.json({
      success: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          pickup: {
            address: order.pickupAddress,
            latitude: order.pickupLatitude ? parseFloat(order.pickupLatitude) : null,
            longitude: order.pickupLongitude ? parseFloat(order.pickupLongitude) : null
          },
          delivery: {
            address: order.deliveryAddress,
            latitude: order.deliveryLatitude ? parseFloat(order.deliveryLatitude) : null,
            longitude: order.deliveryLongitude ? parseFloat(order.deliveryLongitude) : null
          }
        },
        driverLocation,
        trackingPoints: trackingPoints.map(point => ({
          latitude: point.latitude ? parseFloat(point.latitude) : null,
          longitude: point.longitude ? parseFloat(point.longitude) : null,
          status: point.status,
          timestamp: point.timestamp
        })),
        eta,
        websocketUrl: `/ws?token=${req.headers.authorization?.replace('Bearer ', '')}`,
        mapConfig: {
          center: driverLocation || {
            latitude: order.deliveryLatitude ? parseFloat(order.deliveryLatitude) : 0,
            longitude: order.deliveryLongitude ? parseFloat(order.deliveryLongitude) : 0
          },
          zoom: 14,
          apiKey: process.env.GOOGLE_MAPS_API_KEY ? '***' : null
        }
      }
    });
  } catch (error) {
    console.error('Map tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get map tracking data'
    });
  }
});

// GET /api/map/nearby-drivers - Get nearby available drivers
router.get('/nearby-drivers', requireAuth, async (req, res) => {
  try {
    const { latitude, longitude, radius = '5' } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);
    const radiusKm = parseFloat(radius as string);

    // Get available drivers within radius using Haversine formula
    const nearbyDrivers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        rating: driverProfiles.rating,
        totalTrips: driverProfiles.totalTrips,
        currentLatitude: driverProfiles.currentLatitude,
        currentLongitude: driverProfiles.currentLongitude,
        vehicleType: driverProfiles.vehicleType,
        vehicleNumber: driverProfiles.vehicleNumber
      })
      .from(users)
      .innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .where(and(
        eq(driverProfiles.isAvailable, true),
        eq(users.role, 'DRIVER'),
        isNull(users.deletedAt)
      ));

    // Filter by distance
    const driversWithDistance = nearbyDrivers
      .filter(driver => {
        if (!driver.currentLatitude || !driver.currentLongitude) return false;
        
        const distance = GeolocationService.haversineDistance(
          { latitude: lat, longitude: lng },
          { 
            latitude: parseFloat(driver.currentLatitude), 
            longitude: parseFloat(driver.currentLongitude) 
          }
        );
        
        return distance <= radiusKm;
      })
      .map(driver => ({
        id: driver.id,
        name: driver.fullName,
        phone: driver.phone,
        rating: driver.rating,
        totalTrips: driver.totalTrips,
        location: {
          latitude: parseFloat(driver.currentLatitude!),
          longitude: parseFloat(driver.currentLongitude!)
        },
        vehicle: {
          type: driver.vehicleType,
          number: driver.vehicleNumber
        },
        distance: GeolocationService.haversineDistance(
          { latitude: lat, longitude: lng },
          { 
            latitude: parseFloat(driver.currentLatitude!), 
            longitude: parseFloat(driver.currentLongitude!) 
          }
        )
      }))
      .sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      data: {
        drivers: driversWithDistance,
        searchLocation: { latitude: lat, longitude: lng },
        radius: radiusKm,
        count: driversWithDistance.length
      }
    });
  } catch (error) {
    console.error('Nearby drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby drivers'
    });
  }
});

export default router;
