
import express from 'express';
import { z } from 'zod';
import GeolocationService from '../services/geolocation';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const addressValidationSchema = z.object({
  address: z.string().min(1, 'Address is required')
});

const distanceCalculationSchema = z.object({
  origin: coordinatesSchema,
  destination: coordinatesSchema,
  mode: z.enum(['driving', 'walking', 'transit']).optional().default('driving')
});

const routeOptimizationSchema = z.object({
  start: coordinatesSchema,
  end: coordinatesSchema,
  waypoints: z.array(coordinatesSchema)
});

const nearbyPlacesSchema = z.object({
  location: coordinatesSchema,
  radius: z.number().positive().optional().default(5000),
  type: z.string().optional().default('restaurant')
});

// POST /api/geolocation/validate-address - Validate and format address
router.post('/validate-address', requireAuth, async (req, res) => {
  try {
    const { address } = addressValidationSchema.parse(req.body);
    
    const result = await GeolocationService.validateAddress(address);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Address validation error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to validate address'
    });
  }
});

// POST /api/geolocation/reverse-geocode - Get address from coordinates
router.post('/reverse-geocode', requireAuth, async (req, res) => {
  try {
    const { latitude, longitude } = coordinatesSchema.parse(req.body);
    
    const address = await GeolocationService.getAddressFromCoordinates(latitude, longitude);
    
    res.json({
      success: true,
      data: {
        address: address || 'Address not found',
        coordinates: { latitude, longitude }
      }
    });
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to get address from coordinates'
    });
  }
});

// POST /api/geolocation/calculate-distance - Calculate distance between two points
router.post('/calculate-distance', requireAuth, async (req, res) => {
  try {
    const { origin, destination, mode } = distanceCalculationSchema.parse(req.body);
    
    const result = await GeolocationService.calculateDistance(origin, destination, mode);
    
    if (!result) {
      return res.status(400).json({
        success: false,
        message: 'Unable to calculate distance'
      });
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Distance calculation error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to calculate distance'
    });
  }
});

// POST /api/geolocation/optimize-route - Optimize route with multiple waypoints
router.post('/optimize-route', requireAuth, async (req, res) => {
  try {
    const { start, end, waypoints } = routeOptimizationSchema.parse(req.body);
    
    const result = await GeolocationService.optimizeRoute(start, end, waypoints);
    
    if (!result) {
      return res.status(400).json({
        success: false,
        message: 'Unable to optimize route'
      });
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Route optimization error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to optimize route'
    });
  }
});

// POST /api/geolocation/nearby-places - Find nearby places
router.post('/nearby-places', requireAuth, async (req, res) => {
  try {
    const { location, radius, type } = nearbyPlacesSchema.parse(req.body);
    
    const places = await GeolocationService.getNearbyPlaces(location, radius, type);
    
    res.json({
      success: true,
      data: {
        places,
        location,
        radius,
        type
      }
    });
  } catch (error) {
    console.error('Nearby places error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to find nearby places'
    });
  }
});

export default router;
