
import express from 'express';
import { db } from '../db/config';
import { driverProfiles, users, auditLogs } from '../db/schema';
import { eq, isNull, desc, and, or, ilike, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createDriverProfileSchema = z.object({
  userId: z.number().int().positive(),
  vehicleType: z.string().max(50).optional(),
  vehiclePlate: z.string().max(20).optional(),
  vehicleModel: z.string().max(100).optional(),
  vehicleColor: z.string().optional(),
  licenseNumber: z.string().optional(),
  vehicleRegistration: z.string().optional(),
  isOnline: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  currentLocation: z.string().optional(),
  verificationLevel: z.string().default('BASIC'),
  backgroundCheckStatus: z.string().default('PENDING'),
  kycData: z.any().default({})
});

const updateDriverProfileSchema = z.object({
  vehicleType: z.string().max(50).optional(),
  vehiclePlate: z.string().max(20).optional(),
  vehicleModel: z.string().max(100).optional(),
  vehicleColor: z.string().optional(),
  licenseNumber: z.string().optional(),
  vehicleRegistration: z.string().optional(),
  isOnline: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  currentLocation: z.string().optional(),
  verificationLevel: z.string().optional(),
  backgroundCheckStatus: z.string().optional(),
  kycData: z.any().optional()
});

const updateLocationSchema = z.object({
  latitude: z.string().refine((val) => !isNaN(Number(val)) && Math.abs(Number(val)) <= 90, {
    message: "Latitude must be a valid number between -90 and 90"
  }),
  longitude: z.string().refine((val) => !isNaN(Number(val)) && Math.abs(Number(val)) <= 180, {
    message: "Longitude must be a valid number between -180 and 180"
  }),
  currentLocation: z.string().optional(),
  isOnline: z.boolean().optional()
});

// Helper function to log audit events
async function logAuditEvent(
  userId: number, 
  action: string, 
  entityId: number, 
  details: any = {}
) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'DRIVER_PROFILE',
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

// POST /api/drivers - Create a new driver profile
router.post('/', requireAuth, requireRole(['ADMIN', 'DRIVER']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = createDriverProfileSchema.parse(req.body);

    // Only admins can create profiles for other users
    if (currentUser.role !== 'ADMIN' && validatedData.userId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only create your own driver profile'
      });
    }

    // Verify the user exists and has DRIVER role
    const user = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, validatedData.userId),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!user.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user[0].role !== 'DRIVER' && currentUser.role !== 'ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'User must have DRIVER role to create driver profile'
      });
    }

    // Check if driver profile already exists
    const existingProfile = await db
      .select()
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.userId, validatedData.userId),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (existingProfile.length) {
      return res.status(400).json({
        success: false,
        message: 'Driver profile already exists for this user'
      });
    }

    // Create the driver profile
    const newProfile = await db.insert(driverProfiles).values({
      userId: validatedData.userId,
      vehicleType: validatedData.vehicleType || null,
      vehiclePlate: validatedData.vehiclePlate || null,
      vehicleModel: validatedData.vehicleModel || null,
      vehicleColor: validatedData.vehicleColor || null,
      licenseNumber: validatedData.licenseNumber || null,
      vehicleRegistration: validatedData.vehicleRegistration || null,
      isOnline: validatedData.isOnline,
      isAvailable: validatedData.isAvailable,
      currentLocation: validatedData.currentLocation || null,
      verificationLevel: validatedData.verificationLevel,
      backgroundCheckStatus: validatedData.backgroundCheckStatus,
      kycData: validatedData.kycData
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DRIVER_PROFILE_CREATED',
      newProfile[0].id,
      { 
        driverUserId: validatedData.userId,
        vehicleType: validatedData.vehicleType,
        vehiclePlate: validatedData.vehiclePlate
      }
    );

    res.status(201).json({
      success: true,
      message: 'Driver profile created successfully',
      data: newProfile[0]
    });
  } catch (error) {
    console.error('Create driver profile error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create driver profile'
    });
  }
});

// GET /api/drivers - List all driver profiles
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const isOnline = req.query.isOnline as string;
    const isAvailable = req.query.isAvailable as string;
    const verificationStatus = req.query.verificationStatus as string;
    const tier = req.query.tier as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(driverProfiles.deletedAt)];

    // Non-admin users can only see verified and available drivers
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        eq(driverProfiles.verificationStatus, 'APPROVED'),
        eq(driverProfiles.isAvailable, true)
      );
    }

    if (search) {
      conditions.push(
        or(
          ilike(users.fullName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(driverProfiles.vehiclePlate, `%${search}%`),
          ilike(driverProfiles.vehicleModel, `%${search}%`)
        )!
      );
    }

    if (isOnline === 'true') {
      conditions.push(eq(driverProfiles.isOnline, true));
    } else if (isOnline === 'false') {
      conditions.push(eq(driverProfiles.isOnline, false));
    }

    if (isAvailable === 'true') {
      conditions.push(eq(driverProfiles.isAvailable, true));
    } else if (isAvailable === 'false') {
      conditions.push(eq(driverProfiles.isAvailable, false));
    }

    if (verificationStatus) {
      conditions.push(eq(driverProfiles.verificationStatus, verificationStatus as any));
    }

    if (tier) {
      conditions.push(eq(driverProfiles.tier, tier as any));
    }

    // Get driver profiles with user info
    const driversList = await db
      .select({
        profile: driverProfiles,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          profilePicture: users.profilePicture,
          averageRating: users.averageRating,
          totalRatings: users.totalRatings
        }
      })
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(desc(driverProfiles.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCountResult = await db
      .select({ count: driverProfiles.id })
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

    const totalCount = totalCountResult.length;

    res.json({
      success: true,
      data: driversList,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('List driver profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve driver profiles'
    });
  }
});

// GET /api/drivers/:id - Get driver profile details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver profile ID'
      });
    }

    // Build query conditions
    const conditions = [
      eq(driverProfiles.id, profileId),
      isNull(driverProfiles.deletedAt)
    ];

    // Non-admin users can only access their own profile or verified profiles
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(driverProfiles.userId, currentUser.id),
          eq(driverProfiles.verificationStatus, 'APPROVED')
        )!
      );
    }

    const profile = await db
      .select({
        profile: driverProfiles,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          profilePicture: users.profilePicture,
          averageRating: users.averageRating,
          totalRatings: users.totalRatings,
          isVerified: users.isVerified,
          isActive: users.isActive
        }
      })
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .where(and(...conditions))
      .limit(1);

    if (!profile.length) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    res.json({
      success: true,
      data: profile[0]
    });
  } catch (error) {
    console.error('Get driver profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve driver profile'
    });
  }
});

// PUT /api/drivers/:id - Update driver profile details
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);
    const validatedData = updateDriverProfileSchema.parse(req.body);

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver profile ID'
      });
    }

    // Check if profile exists and user has permission
    const conditions = [
      eq(driverProfiles.id, profileId),
      isNull(driverProfiles.deletedAt)
    ];

    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(driverProfiles.userId, currentUser.id));
    }

    const existingProfile = await db
      .select()
      .from(driverProfiles)
      .where(and(...conditions))
      .limit(1);

    if (!existingProfile.length) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found or access denied'
      });
    }

    // Update the profile
    const updatedProfile = await db
      .update(driverProfiles)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.id, profileId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DRIVER_PROFILE_UPDATED',
      profileId,
      { changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Driver profile updated successfully',
      data: updatedProfile[0]
    });
  } catch (error) {
    console.error('Update driver profile error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update driver profile'
    });
  }
});

// POST /api/drivers/:id/verify - Verify a driver profile
router.post('/:id/verify', requireAuth, requireAdmin, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);
    const { verificationStatus = 'APPROVED', kycStatus = 'APPROVED', tier = 'STANDARD' } = req.body;

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver profile ID'
      });
    }

    // Check if profile exists
    const existingProfile = await db
      .select()
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.id, profileId),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (!existingProfile.length) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Update verification status
    const updatedProfile = await db
      .update(driverProfiles)
      .set({
        verificationStatus: verificationStatus,
        kycStatus: kycStatus,
        tier: tier,
        kycApprovedAt: new Date(),
        kycApprovedBy: currentUser.id,
        updatedAt: new Date()
      })
      .where(eq(driverProfiles.id, profileId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DRIVER_PROFILE_VERIFIED',
      profileId,
      { 
        verificationStatus,
        kycStatus,
        tier,
        driverUserId: existingProfile[0].userId
      }
    );

    res.json({
      success: true,
      message: 'Driver profile verified successfully',
      data: updatedProfile[0]
    });
  } catch (error) {
    console.error('Verify driver profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify driver profile'
    });
  }
});

// POST /api/drivers/:id/location - Update driver location
router.post('/:id/location', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);
    const validatedData = updateLocationSchema.parse(req.body);

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver profile ID'
      });
    }

    // Check if profile exists and user has permission
    const conditions = [
      eq(driverProfiles.id, profileId),
      isNull(driverProfiles.deletedAt)
    ];

    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(driverProfiles.userId, currentUser.id));
    }

    const existingProfile = await db
      .select()
      .from(driverProfiles)
      .where(and(...conditions))
      .limit(1);

    if (!existingProfile.length) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found or access denied'
      });
    }

    // Update location and online status
    const updateData: any = {
      currentLatitude: validatedData.latitude,
      currentLongitude: validatedData.longitude,
      updatedAt: new Date()
    };

    if (validatedData.currentLocation) {
      updateData.currentLocation = validatedData.currentLocation;
    }

    if (validatedData.isOnline !== undefined) {
      updateData.isOnline = validatedData.isOnline;
    }

    const updatedProfile = await db
      .update(driverProfiles)
      .set(updateData)
      .where(eq(driverProfiles.id, profileId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DRIVER_LOCATION_UPDATED',
      profileId,
      { 
        latitude: validatedData.latitude,
        longitude: validatedData.longitude,
        currentLocation: validatedData.currentLocation,
        isOnline: validatedData.isOnline
      }
    );

    res.json({
      success: true,
      message: 'Driver location updated successfully',
      data: updatedProfile[0]
    });
  } catch (error) {
    console.error('Update driver location error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update driver location'
    });
  }
});

export default router;
