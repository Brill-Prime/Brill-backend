
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { orders, driverProfiles, users, auditLogs, tracking } from '../db/schema';
import { eq, and, desc, isNull, sql, gte, lte } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';
import GeolocationService from '../services/geolocation';
import RouteOptimizationService from '../services/routeOptimization';
import { getWebSocketService } from '../services/websocket';

const router = express.Router();

// Validation schemas
const findDriversSchema = z.object({
  orderId: z.number().int().positive(),
  radius: z.number().positive().optional().default(10), // km
  maxDrivers: z.number().int().positive().optional().default(10)
});

const assignDriverSchema = z.object({
  orderId: z.number().int().positive(),
  driverId: z.number().int().positive(),
  estimatedEarnings: z.number().positive().optional()
});

const updateAssignmentSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED', 'CANCELLED']),
  rejectionReason: z.string().optional()
});

// POST /api/delivery-assignments/find-drivers - Find available drivers
router.post('/find-drivers', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const validatedData = findDriversSchema.parse(req.body);
    
    // Get order details
    const [order] = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, validatedData.orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Validate address if coordinates not available
    let orderLat = parseFloat(order.deliveryLatitude || '0');
    let orderLng = parseFloat(order.deliveryLongitude || '0');

    if (!orderLat || !orderLng) {
      const addressResult = await GeolocationService.validateAddress(order.deliveryAddress || '');
      if (addressResult.isValid && addressResult.coordinates) {
        orderLat = addressResult.coordinates.latitude;
        orderLng = addressResult.coordinates.longitude;
        
        // Update order with coordinates
        await db
          .update(orders)
          .set({
            deliveryLatitude: orderLat.toString(),
            deliveryLongitude: orderLng.toString()
          })
          .where(eq(orders.id, order.id));
      }
    }

    // Find available drivers within radius
    const availableDrivers = await db
      .select({
        driver: driverProfiles,
        user: {
          id: users.id,
          fullName: users.fullName,
          phone: users.phone,
          averageRating: users.averageRating,
          totalRatings: users.totalRatings
        }
      })
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .where(and(
        eq(driverProfiles.isOnline, true),
        eq(driverProfiles.isAvailable, true),
        eq(driverProfiles.verificationStatus, 'APPROVED'),
        isNull(driverProfiles.deletedAt),
        isNull(users.deletedAt)
      ));

    // Filter by distance and calculate metrics
    const driversWithMetrics = [];
    
    for (const driverData of availableDrivers) {
      const driver = driverData.driver;
      if (!driver.currentLatitude || !driver.currentLongitude) continue;

      const driverLat = parseFloat(driver.currentLatitude);
      const driverLng = parseFloat(driver.currentLongitude);
      
      const distance = GeolocationService.haversineDistance(
        { latitude: orderLat, longitude: orderLng },
        { latitude: driverLat, longitude: driverLng }
      );

      if (distance <= validatedData.radius) {
        // Calculate estimated travel time
        const travelTime = (distance / 30) * 60; // Assuming 30 km/h average speed
        
        // Calculate driver score
        const rating = parseFloat(driverData.user.averageRating || '0');
        const completedDeliveries = driver.totalDeliveries || 0;
        const score = calculateDriverScore(rating, completedDeliveries, distance, travelTime);

        driversWithMetrics.push({
          driverId: driver.userId,
          driverName: driverData.user.fullName,
          phone: driverData.user.phone,
          rating: rating,
          totalDeliveries: completedDeliveries,
          distance: Math.round(distance * 100) / 100,
          estimatedTravelTime: Math.round(travelTime),
          vehicleType: driver.vehicleType,
          vehiclePlate: driver.vehiclePlate,
          currentLocation: driver.currentLocation,
          score: score,
          tier: driver.tier
        });
      }
    }

    // Sort by score (highest first) and limit results
    const sortedDrivers = driversWithMetrics
      .sort((a, b) => b.score - a.score)
      .slice(0, validatedData.maxDrivers);

    res.json({
      success: true,
      data: {
        orderId: validatedData.orderId,
        orderLocation: {
          latitude: orderLat,
          longitude: orderLng,
          address: order.deliveryAddress
        },
        availableDrivers: sortedDrivers,
        searchRadius: validatedData.radius,
        totalFound: sortedDrivers.length
      }
    });
  } catch (error) {
    console.error('Find drivers error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to find drivers'
    });
  }
});

// POST /api/delivery-assignments/assign - Assign driver to order
router.post('/assign', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const validatedData = assignDriverSchema.parse(req.body);
    const userId = req.user!.id;

    // Get order and verify ownership/permission
    const [order] = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, validatedData.orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check permission (merchant owns order or admin)
    if (req.user!.role !== 'ADMIN' && order.merchantId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Verify driver is available and qualified
    const [driverProfile] = await db
      .select()
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.userId, validatedData.driverId),
        eq(driverProfiles.isOnline, true),
        eq(driverProfiles.isAvailable, true),
        eq(driverProfiles.verificationStatus, 'APPROVED'),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (!driverProfile) {
      return res.status(400).json({
        success: false,
        message: 'Driver not available or not qualified'
      });
    }

    // Calculate estimated earnings if not provided
    let estimatedEarnings = validatedData.estimatedEarnings;
    if (!estimatedEarnings) {
      const baseRate = 1000; // Base delivery fee in NGN
      const orderAmount = parseFloat(order.totalAmount);
      const distanceBonus = 0; // Would calculate based on distance
      estimatedEarnings = baseRate + (orderAmount * 0.1) + distanceBonus;
    }

    // Update order with driver assignment
    await db
      .update(orders)
      .set({
        driverId: validatedData.driverId,
        driverEarnings: estimatedEarnings.toString(),
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(orders.id, validatedData.orderId));

    // Mark driver as busy
    await db
      .update(driverProfiles)
      .set({
        isAvailable: false,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.userId, validatedData.driverId));

    // Log audit event
    await db.insert(auditLogs).values({
      userId: userId,
      action: 'DRIVER_ASSIGNED',
      entityType: 'ORDER',
      entityId: validatedData.orderId,
      details: {
        driverId: validatedData.driverId,
        estimatedEarnings,
        orderNumber: order.orderNumber
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Send real-time notification to driver
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.sendNotificationToUser(validatedData.driverId, {
        type: 'DELIVERY_ASSIGNMENT',
        title: 'New Delivery Assignment',
        message: `You have been assigned order ${order.orderNumber}`,
        data: {
          orderId: validatedData.orderId,
          orderNumber: order.orderNumber,
          estimatedEarnings,
          deliveryAddress: order.deliveryAddress
        }
      });
    }

    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        orderId: validatedData.orderId,
        driverId: validatedData.driverId,
        estimatedEarnings,
        status: 'ACCEPTED'
      }
    });
  } catch (error) {
    console.error('Assign driver error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to assign driver'
    });
  }
});

// GET /api/delivery-assignments/driver/pending - Get pending assignments for driver
router.get('/driver/pending', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const driverId = req.user!.id;

    const pendingAssignments = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        merchantId: orders.merchantId,
        totalAmount: orders.totalAmount,
        driverEarnings: orders.driverEarnings,
        deliveryAddress: orders.deliveryAddress,
        deliveryLatitude: orders.deliveryLatitude,
        deliveryLongitude: orders.deliveryLongitude,
        pickupAddress: orders.pickupAddress,
        status: orders.status,
        acceptedAt: orders.acceptedAt,
        createdAt: orders.createdAt,
        customer: {
          fullName: users.fullName,
          phone: users.phone
        }
      })
      .from(orders)
      .leftJoin(users, eq(orders.customerId, users.id))
      .where(and(
        eq(orders.driverId, driverId),
        eq(orders.status, 'ACCEPTED'),
        isNull(orders.deletedAt)
      ))
      .orderBy(desc(orders.acceptedAt));

    // Calculate distances and ETAs for each assignment
    const assignmentsWithMetrics = [];
    
    for (const assignment of pendingAssignments) {
      let distance = 0;
      let estimatedTravelTime = 0;

      if (assignment.deliveryLatitude && assignment.deliveryLongitude) {
        // Get driver's current location
        const [driverProfile] = await db
          .select()
          .from(driverProfiles)
          .where(eq(driverProfiles.userId, driverId))
          .limit(1);

        if (driverProfile?.currentLatitude && driverProfile?.currentLongitude) {
          distance = GeolocationService.haversineDistance(
            {
              latitude: parseFloat(driverProfile.currentLatitude),
              longitude: parseFloat(driverProfile.currentLongitude)
            },
            {
              latitude: parseFloat(assignment.deliveryLatitude),
              longitude: parseFloat(assignment.deliveryLongitude)
            }
          );
          estimatedTravelTime = (distance / 30) * 60; // 30 km/h average
        }
      }

      assignmentsWithMetrics.push({
        ...assignment,
        distance: Math.round(distance * 100) / 100,
        estimatedTravelTime: Math.round(estimatedTravelTime),
        estimatedEarnings: assignment.driverEarnings ? parseFloat(assignment.driverEarnings) : 0
      });
    }

    res.json({
      success: true,
      data: assignmentsWithMetrics,
      count: assignmentsWithMetrics.length
    });
  } catch (error) {
    console.error('Get driver pending assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending assignments'
    });
  }
});

// POST /api/delivery-assignments/:orderId/respond - Driver responds to assignment
router.post('/:orderId/respond', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const driverId = req.user!.id;
    const validatedData = updateAssignmentSchema.parse(req.body);

    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Verify assignment exists and belongs to driver
    const [order] = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        eq(orders.driverId, driverId),
        eq(orders.status, 'ACCEPTED'),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found or not accessible'
      });
    }

    let newOrderStatus: string;
    let driverAvailable = true;

    if (validatedData.status === 'ACCEPTED') {
      newOrderStatus = 'PICKED_UP';
      driverAvailable = false; // Driver is now busy with this order
      
      // Create initial tracking entry
      const [driverProfile] = await db
        .select()
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, driverId))
        .limit(1);

      if (driverProfile?.currentLatitude && driverProfile?.currentLongitude) {
        await db.insert(tracking).values({
          orderId: orderId,
          driverId: driverId,
          latitude: driverProfile.currentLatitude,
          longitude: driverProfile.currentLongitude,
          status: 'ACCEPTED',
          timestamp: new Date()
        });
      }
    } else if (validatedData.status === 'REJECTED') {
      newOrderStatus = 'PENDING';
      driverAvailable = true;
      
      // Clear driver assignment
      await db
        .update(orders)
        .set({
          driverId: null,
          driverEarnings: null
        })
        .where(eq(orders.id, orderId));
    } else {
      newOrderStatus = 'CANCELLED';
      driverAvailable = true;
    }

    // Update order status
    await db
      .update(orders)
      .set({
        status: newOrderStatus as any,
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));

    // Update driver availability
    await db
      .update(driverProfiles)
      .set({
        isAvailable: driverAvailable,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.userId, driverId));

    // Log audit event
    await db.insert(auditLogs).values({
      userId: driverId,
      action: 'ASSIGNMENT_RESPONSE',
      entityType: 'ORDER',
      entityId: orderId,
      details: {
        response: validatedData.status,
        rejectionReason: validatedData.rejectionReason,
        orderNumber: order.orderNumber
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Send notifications to relevant parties
    const wsService = getWebSocketService();
    if (wsService) {
      // Notify customer
      if (order.customerId) {
        await wsService.sendNotificationToUser(order.customerId, {
          type: 'ASSIGNMENT_UPDATE',
          title: 'Delivery Update',
          message: validatedData.status === 'ACCEPTED' ? 
            'Your driver has accepted the delivery' : 
            'Looking for another driver for your order',
          data: { orderId, status: validatedData.status }
        });
      }

      // Notify merchant
      if (order.merchantId) {
        await wsService.sendNotificationToUser(order.merchantId, {
          type: 'ASSIGNMENT_UPDATE',
          title: 'Driver Response',
          message: `Driver ${validatedData.status.toLowerCase()} order ${order.orderNumber}`,
          data: { orderId, status: validatedData.status }
        });
      }
    }

    res.json({
      success: true,
      message: `Assignment ${validatedData.status.toLowerCase()} successfully`,
      data: {
        orderId,
        status: validatedData.status,
        newOrderStatus
      }
    });
  } catch (error) {
    console.error('Assignment response error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to respond to assignment'
    });
  }
});

// Helper function to calculate driver score
function calculateDriverScore(
  rating: number,
  completedDeliveries: number,
  distance: number,
  travelTime: number
): number {
  // Base score from rating (0-50 points)
  const ratingScore = rating * 10;
  
  // Experience bonus (0-25 points)
  const experienceScore = Math.min(completedDeliveries * 0.5, 25);
  
  // Distance penalty (closer is better)
  const distanceScore = Math.max(25 - distance * 2, 0);
  
  // Time penalty (faster is better)
  const timeScore = Math.max(15 - travelTime * 0.1, 0);
  
  return ratingScore + experienceScore + distanceScore + timeScore;
}

export default router;
