
import express from 'express';
import { db } from '../db/config';
import { merchantProfiles, users, auditLogs, orders } from '../db/schema';
import { eq, isNull, desc, and, or, ilike, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createMerchantProfileSchema = z.object({
  userId: z.number().int().positive(),
  businessName: z.string().min(1),
  businessAddress: z.string().optional(),
  businessType: z.string().optional(),
  businessPhone: z.string().optional(),
  businessEmail: z.string().email().optional(),
  latitude: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Math.abs(Number(val)) <= 90), {
    message: "Latitude must be a valid number between -90 and 90"
  }),
  longitude: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Math.abs(Number(val)) <= 180), {
    message: "Longitude must be a valid number between -180 and 180"
  }),
  phone: z.string().optional(),
  description: z.string().optional(),
  operatingHours: z.any().default({}),
  isOpen: z.boolean().default(true),
  isVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  verificationLevel: z.string().default('BASIC'),
  backgroundCheckStatus: z.string().default('PENDING'),
  kycData: z.any().default({})
});

const updateMerchantProfileSchema = z.object({
  businessName: z.string().min(1).optional(),
  businessAddress: z.string().optional(),
  businessType: z.string().optional(),
  businessPhone: z.string().optional(),
  businessEmail: z.string().email().optional(),
  latitude: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Math.abs(Number(val)) <= 90), {
    message: "Latitude must be a valid number between -90 and 90"
  }),
  longitude: z.string().optional().refine((val) => !val || (!isNaN(Number(val)) && Math.abs(Number(val)) <= 180), {
    message: "Longitude must be a valid number between -180 and 180"
  }),
  phone: z.string().optional(),
  description: z.string().optional(),
  operatingHours: z.any().optional(),
  isOpen: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  isActive: z.boolean().optional(),
  verificationLevel: z.string().optional(),
  backgroundCheckStatus: z.string().optional(),
  kycData: z.any().optional()
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
      entityType: 'MERCHANT_PROFILE',
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

// POST /api/merchants - Create a new merchant profile
router.post('/', requireAuth, requireRole(['ADMIN', 'MERCHANT']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = createMerchantProfileSchema.parse(req.body);

    // Only admins can create profiles for other users
    if (currentUser.role !== 'ADMIN' && validatedData.userId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only create your own merchant profile'
      });
    }

    // Verify the user exists and has MERCHANT role
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

    if (user[0].role !== 'MERCHANT' && currentUser.role !== 'ADMIN') {
      return res.status(400).json({
        success: false,
        message: 'User must have MERCHANT role to create merchant profile'
      });
    }

    // Check if merchant profile already exists
    const existingProfile = await db
      .select()
      .from(merchantProfiles)
      .where(and(
        eq(merchantProfiles.userId, validatedData.userId),
        isNull(merchantProfiles.deletedAt)
      ))
      .limit(1);

    if (existingProfile.length) {
      return res.status(400).json({
        success: false,
        message: 'Merchant profile already exists for this user'
      });
    }

    // Create the merchant profile
    const newProfile = await db.insert(merchantProfiles).values({
      userId: validatedData.userId,
      businessName: validatedData.businessName,
      businessAddress: validatedData.businessAddress || null,
      businessType: validatedData.businessType || null,
      businessPhone: validatedData.businessPhone || null,
      businessEmail: validatedData.businessEmail || null,
      latitude: validatedData.latitude || null,
      longitude: validatedData.longitude || null,
      phone: validatedData.phone || null,
      description: validatedData.description || null,
      operatingHours: validatedData.operatingHours,
      isOpen: validatedData.isOpen,
      isVerified: validatedData.isVerified,
      isActive: validatedData.isActive,
      verificationLevel: validatedData.verificationLevel,
      backgroundCheckStatus: validatedData.backgroundCheckStatus,
      kycData: validatedData.kycData
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'MERCHANT_PROFILE_CREATED',
      newProfile[0].id,
      { 
        merchantUserId: validatedData.userId,
        businessName: validatedData.businessName,
        businessType: validatedData.businessType
      }
    );

    res.status(201).json({
      success: true,
      message: 'Merchant profile created successfully',
      data: newProfile[0]
    });
  } catch (error) {
    console.error('Create merchant profile error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create merchant profile'
    });
  }
});

// GET /api/merchants - List all merchant profiles
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const isOpen = req.query.isOpen as string;
    const isVerified = req.query.isVerified as string;
    const isActive = req.query.isActive as string;
    const verificationStatus = req.query.verificationStatus as string;
    const businessType = req.query.businessType as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(merchantProfiles.deletedAt)];

    // Non-admin users can only see verified and active merchant profiles
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        eq(merchantProfiles.isVerified, true),
        eq(merchantProfiles.isActive, true)
      );
    }

    if (search) {
      conditions.push(
        or(
          ilike(merchantProfiles.businessName, `%${search}%`),
          ilike(merchantProfiles.businessType, `%${search}%`),
          ilike(merchantProfiles.description, `%${search}%`),
          ilike(users.fullName, `%${search}%`),
          ilike(users.email, `%${search}%`)
        )!
      );
    }

    if (isOpen === 'true') {
      conditions.push(eq(merchantProfiles.isOpen, true));
    } else if (isOpen === 'false') {
      conditions.push(eq(merchantProfiles.isOpen, false));
    }

    if (isVerified === 'true') {
      conditions.push(eq(merchantProfiles.isVerified, true));
    } else if (isVerified === 'false') {
      conditions.push(eq(merchantProfiles.isVerified, false));
    }

    if (isActive === 'true') {
      conditions.push(eq(merchantProfiles.isActive, true));
    } else if (isActive === 'false') {
      conditions.push(eq(merchantProfiles.isActive, false));
    }

    if (verificationStatus) {
      conditions.push(eq(merchantProfiles.verificationStatus, verificationStatus as any));
    }

    if (businessType) {
      conditions.push(ilike(merchantProfiles.businessType, `%${businessType}%`));
    }

    // Get merchant profiles with user info
    const merchantsList = await db
      .select({
        profile: merchantProfiles,
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
      .from(merchantProfiles)
      .innerJoin(users, eq(merchantProfiles.userId, users.id))
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(desc(merchantProfiles.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCountResult = await db
      .select({ count: merchantProfiles.id })
      .from(merchantProfiles)
      .innerJoin(users, eq(merchantProfiles.userId, users.id))
      .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

    const totalCount = totalCountResult.length;

    res.json({
      success: true,
      data: merchantsList,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('List merchant profiles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant profiles'
    });
  }
});

// GET /api/merchants/:id - Get merchant profile details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant profile ID'
      });
    }

    // Build query conditions
    const conditions = [
      eq(merchantProfiles.id, profileId),
      isNull(merchantProfiles.deletedAt)
    ];

    // Non-admin users can only access their own profile or verified profiles
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(merchantProfiles.userId, currentUser.id),
          and(
            eq(merchantProfiles.isVerified, true),
            eq(merchantProfiles.isActive, true)
          )
        )!
      );
    }

    const profile = await db
      .select({
        profile: merchantProfiles,
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
      .from(merchantProfiles)
      .innerJoin(users, eq(merchantProfiles.userId, users.id))
      .where(and(...conditions))
      .limit(1);

    if (!profile.length) {
      return res.status(404).json({
        success: false,
        message: 'Merchant profile not found'
      });
    }

    res.json({
      success: true,
      data: profile[0]
    });
  } catch (error) {
    console.error('Get merchant profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant profile'
    });
  }
});

// PUT /api/merchants/:id - Update merchant profile details
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);
    const validatedData = updateMerchantProfileSchema.parse(req.body);

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant profile ID'
      });
    }

    // Check if profile exists and user has permission
    const conditions = [
      eq(merchantProfiles.id, profileId),
      isNull(merchantProfiles.deletedAt)
    ];

    if (currentUser.role !== 'ADMIN') {
      conditions.push(eq(merchantProfiles.userId, currentUser.id));
    }

    const existingProfile = await db
      .select()
      .from(merchantProfiles)
      .where(and(...conditions))
      .limit(1);

    if (!existingProfile.length) {
      return res.status(404).json({
        success: false,
        message: 'Merchant profile not found or access denied'
      });
    }

    // Update the profile
    const updatedProfile = await db
      .update(merchantProfiles)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(merchantProfiles.id, profileId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'MERCHANT_PROFILE_UPDATED',
      profileId,
      { changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Merchant profile updated successfully',
      data: updatedProfile[0]
    });
  } catch (error) {
    console.error('Update merchant profile error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update merchant profile'
    });
  }
});

// POST /api/merchants/:id/verify - Verify a merchant profile
router.post('/:id/verify', requireAuth, requireAdmin, async (req, res) => {
  try {
    const currentUser = req.user!;
    const profileId = parseInt(req.params.id);
    const { verificationStatus = 'APPROVED', kycStatus = 'APPROVED', isVerified = true } = req.body;

    if (isNaN(profileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant profile ID'
      });
    }

    // Check if profile exists
    const existingProfile = await db
      .select()
      .from(merchantProfiles)
      .where(and(
        eq(merchantProfiles.id, profileId),
        isNull(merchantProfiles.deletedAt)
      ))
      .limit(1);

    if (!existingProfile.length) {
      return res.status(404).json({
        success: false,
        message: 'Merchant profile not found'
      });
    }

    // Update verification status
    const updatedProfile = await db
      .update(merchantProfiles)
      .set({
        verificationStatus: verificationStatus,
        kycStatus: kycStatus,
        isVerified: isVerified,
        kycApprovedAt: new Date(),
        kycApprovedBy: currentUser.id,
        updatedAt: new Date()
      })
      .where(eq(merchantProfiles.id, profileId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'MERCHANT_PROFILE_VERIFIED',
      profileId,
      { 
        verificationStatus,
        kycStatus,
        isVerified,
        merchantUserId: existingProfile[0].userId
      }
    );

    res.json({
      success: true,
      message: 'Merchant profile verified successfully',
      data: updatedProfile[0]
    });
  } catch (error) {
    console.error('Verify merchant profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify merchant profile'
    });
  }
});

// GET /api/merchants/nearby - Get nearby merchants
router.get('/nearby', async (req, res) => {
  try {
    // Support both lat/lng and latitude/longitude parameter formats
    const lat = (req.query.lat || req.query.latitude) as string;
    const lng = (req.query.lng || req.query.longitude) as string;
    const { radius = '10', type } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusKm = parseFloat(radius as string);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates or radius'
      });
    }

    // Get all active merchants with coordinates
    let conditions = [
      eq(merchantProfiles.isActive, true),
      eq(merchantProfiles.isVerified, true),
      isNull(merchantProfiles.deletedAt)
    ];

    if (type) {
      conditions.push(eq(merchantProfiles.businessType, type as string));
    }

    const merchants = await db
      .select({
        id: merchantProfiles.id,
        userId: merchantProfiles.userId,
        businessName: merchantProfiles.businessName,
        businessType: merchantProfiles.businessType,
        businessAddress: merchantProfiles.businessAddress,
        latitude: merchantProfiles.latitude,
        longitude: merchantProfiles.longitude,
        description: merchantProfiles.description,
        isOpen: merchantProfiles.isOpen,
        user: {
          fullName: users.fullName,
          averageRating: users.averageRating,
          totalRatings: users.totalRatings
        }
      })
      .from(merchantProfiles)
      .innerJoin(users, eq(merchantProfiles.userId, users.id))
      .where(and(...conditions));

    // Calculate distance for each merchant
    const GeolocationService = await import('../services/geolocation');
    const nearbyMerchants = merchants
      .filter(m => m.latitude && m.longitude)
      .map(m => {
        const distance = GeolocationService.default.haversineDistance(
          { latitude, longitude },
          { latitude: parseFloat(m.latitude!), longitude: parseFloat(m.longitude!) }
        );
        return { ...m, distance };
      })
      .filter(m => m.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      data: nearbyMerchants,
      count: nearbyMerchants.length
    });
  } catch (error) {
    console.error('Get nearby merchants error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby merchants'
    });
  }
});

// GET /api/merchants/nearby/live - Get nearby merchants with live locations
router.get('/nearby/live', requireAuth, async (req, res) => {
  try {
    const { lat, lng, radius = '10' } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const radiusKm = parseFloat(radius as string);

    const merchants = await db
      .select({
        id: merchantProfiles.id,
        userId: merchantProfiles.userId,
        businessName: merchantProfiles.businessName,
        businessType: merchantProfiles.businessType,
        latitude: merchantProfiles.latitude,
        longitude: merchantProfiles.longitude,
        isOpen: merchantProfiles.isOpen,
        user: {
          fullName: users.fullName,
          averageRating: users.averageRating
        }
      })
      .from(merchantProfiles)
      .innerJoin(users, eq(merchantProfiles.userId, users.id))
      .where(and(
        eq(merchantProfiles.isActive, true),
        eq(merchantProfiles.isOpen, true),
        isNull(merchantProfiles.deletedAt)
      ));

    const GeolocationService = await import('../services/geolocation');
    const nearbyMerchants = merchants
      .filter(m => m.latitude && m.longitude)
      .map(m => {
        const distance = GeolocationService.default.haversineDistance(
          { latitude, longitude },
          { latitude: parseFloat(m.latitude!), longitude: parseFloat(m.longitude!) }
        );
        return { ...m, distance };
      })
      .filter(m => m.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      data: nearbyMerchants,
      count: nearbyMerchants.length
    });
  } catch (error) {
    console.error('Get nearby live merchants error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby live merchants'
    });
  }
});

// GET /api/merchants/:id/orders - Get merchant orders
router.get('/:id/orders', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && currentUser.id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const offset = (page - 1) * limit;
    const conditions = [
      eq(orders.merchantId, merchantId),
      isNull(orders.deletedAt)
    ];

    if (status) {
      conditions.push(eq(orders.status, status as any));
    }

    const merchantOrders = await db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    const totalCount = await db
      .select({ count: orders.id })
      .from(orders)
      .where(and(...conditions));

    res.json({
      success: true,
      data: merchantOrders,
      pagination: {
        page,
        limit,
        total: totalCount.length,
        pages: Math.ceil(totalCount.length / limit)
      }
    });
  } catch (error) {
    console.error('Get merchant orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant orders'
    });
  }
});

// GET /api/merchants/:id/customers - Get merchant customers
router.get('/:id/customers', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && currentUser.id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get unique customers from orders
    const customers = await db
      .selectDistinct({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        profilePicture: users.profilePicture,
        totalOrders: orders.id
      })
      .from(orders)
      .innerJoin(users, eq(orders.customerId, users.id))
      .where(and(
        eq(orders.merchantId, merchantId),
        isNull(orders.deletedAt),
        isNull(users.deletedAt)
      ))
      .orderBy(desc(orders.createdAt));

    res.json({
      success: true,
      data: customers,
      count: customers.length
    });
  } catch (error) {
    console.error('Get merchant customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant customers'
    });
  }
});

// GET /api/merchants/:id/analytics - Get merchant analytics
router.get('/:id/analytics', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && currentUser.id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get merchant orders
    const merchantOrders = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.merchantId, merchantId),
        isNull(orders.deletedAt)
      ));

    const analytics = {
      totalOrders: merchantOrders.length,
      completedOrders: merchantOrders.filter(o => o.status === 'DELIVERED').length,
      pendingOrders: merchantOrders.filter(o => o.status === 'PENDING' || o.status === 'CONFIRMED').length,
      cancelledOrders: merchantOrders.filter(o => o.status === 'CANCELLED').length,
      totalRevenue: merchantOrders
        .filter(o => o.status === 'DELIVERED')
        .reduce((sum, o) => sum + parseFloat(o.totalAmount), 0),
      averageOrderValue: merchantOrders.length > 0 
        ? merchantOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0) / merchantOrders.length 
        : 0
    };

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Get merchant analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant analytics'
    });
  }
});

// GET /api/merchants/:merchantId/commodities - Get merchant's commodities
router.get('/:merchantId/commodities', async (req, res) => {
  try {
    const merchantId = parseInt(req.params.merchantId);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Get products (commodities) for this merchant
    const { products: productsTable, commodities: commoditiesTable } = await import('../db/schema');
    
    const merchantCommodities = await db
      .select({
        id: productsTable.id,
        commodityId: productsTable.commodityId,
        commodityName: commoditiesTable.name,
        commodityDescription: commoditiesTable.description,
        price: productsTable.price,
        unit: productsTable.unit,
        stockQuantity: productsTable.stockQuantity,
        isAvailable: productsTable.isAvailable,
        imageUrl: productsTable.imageUrl,
        createdAt: productsTable.createdAt,
        updatedAt: productsTable.updatedAt
      })
      .from(productsTable)
      .leftJoin(commoditiesTable, eq(productsTable.commodityId, commoditiesTable.id))
      .where(and(
        eq(productsTable.merchantId, merchantId),
        isNull(productsTable.deletedAt)
      ));

    res.json({
      success: true,
      data: merchantCommodities
    });
  } catch (error) {
    console.error('Get merchant commodities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant commodities'
    });
  }
});

// POST /api/merchants/:merchantId/commodities - Add commodity to merchant
router.post('/:merchantId/commodities', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.merchantId);
    const { commodityId, price, unit, stockQuantity, imageUrl } = req.body;

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Check permissions
    const merchantProfile = await db
      .select()
      .from(merchantProfiles)
      .where(and(
        eq(merchantProfiles.userId, currentUser.id),
        isNull(merchantProfiles.deletedAt)
      ))
      .limit(1);

    if (!merchantProfile.length || merchantProfile[0].id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get commodity details
    const { commodities: commoditiesTable, products: productsTable } = await import('../db/schema');
    const [commodity] = await db
      .select()
      .from(commoditiesTable)
      .where(eq(commoditiesTable.id, commodityId))
      .limit(1);

    if (!commodity) {
      return res.status(404).json({
        success: false,
        message: 'Commodity not found'
      });
    }

    // Create product linking commodity to merchant
    const [newProduct] = await db
      .insert(productsTable)
      .values({
        merchantId,
        sellerId: currentUser.id,
        commodityId,
        name: commodity.name,
        description: commodity.description,
        price: price || commodity.price,
        unit: unit || commodity.unit,
        stockQuantity: stockQuantity || 0,
        imageUrl,
        isAvailable: true,
        isActive: true
      })
      .returning();

    res.status(201).json({
      success: true,
      message: 'Commodity added to merchant successfully',
      data: newProduct
    });
  } catch (error) {
    console.error('Add merchant commodity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add commodity to merchant'
    });
  }
});

// PUT /api/merchants/:merchantId/commodities/:commodityId - Update merchant commodity
router.put('/:merchantId/commodities/:commodityId', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.merchantId);
    const commodityId = parseInt(req.params.commodityId);
    const { price, unit, stockQuantity, isAvailable, imageUrl } = req.body;

    // Check permissions
    const merchantProfile = await db
      .select()
      .from(merchantProfiles)
      .where(and(
        eq(merchantProfiles.userId, currentUser.id),
        isNull(merchantProfiles.deletedAt)
      ))
      .limit(1);

    if (!merchantProfile.length || merchantProfile[0].id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Find and update the product
    const { products: productsTable } = await import('../db/schema');
    const [updatedProduct] = await db
      .update(productsTable)
      .set({
        price,
        unit,
        stockQuantity,
        isAvailable,
        imageUrl,
        updatedAt: new Date()
      })
      .where(and(
        eq(productsTable.merchantId, merchantId),
        eq(productsTable.commodityId, commodityId),
        isNull(productsTable.deletedAt)
      ))
      .returning();

    if (!updatedProduct) {
      return res.status(404).json({
        success: false,
        message: 'Commodity not found for this merchant'
      });
    }

    res.json({
      success: true,
      message: 'Commodity updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    console.error('Update merchant commodity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update commodity'
    });
  }
});

// DELETE /api/merchants/:merchantId/commodities/:commodityId - Remove commodity from merchant
router.delete('/:merchantId/commodities/:commodityId', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.merchantId);
    const commodityId = parseInt(req.params.commodityId);

    // Check permissions
    const merchantProfile = await db
      .select()
      .from(merchantProfiles)
      .where(and(
        eq(merchantProfiles.userId, currentUser.id),
        isNull(merchantProfiles.deletedAt)
      ))
      .limit(1);

    if (!merchantProfile.length || merchantProfile[0].id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Soft delete the product
    const { products: productsTable } = await import('../db/schema');
    const result = await db
      .update(productsTable)
      .set({
        deletedAt: new Date()
      })
      .where(and(
        eq(productsTable.merchantId, merchantId),
        eq(productsTable.commodityId, commodityId),
        isNull(productsTable.deletedAt)
      ))
      .returning();

    if (!result.length) {
      return res.status(404).json({
        success: false,
        message: 'Commodity not found for this merchant'
      });
    }

    res.json({
      success: true,
      message: 'Commodity removed from merchant successfully'
    });
  } catch (error) {
    console.error('Delete merchant commodity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove commodity from merchant'
    });
  }
});

// DELETE /api/merchants/:id - Delete a merchant profile
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);
    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Check if merchant exists
    const existingMerchant = await db
      .select()
      .from(merchantProfiles)
      .where(eq(merchantProfiles.id, merchantId))
      .limit(1);

    if (existingMerchant.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Merchant profile not found'
      });
    }

    // Soft delete the merchant profile
    await db
      .update(merchantProfiles)
      .set({
        deletedAt: new Date(),
        isActive: false
      })
      .where(eq(merchantProfiles.id, merchantId));

    // Log the deletion
    await logAuditEvent(
      req.user!.id,
      'DELETE_MERCHANT_PROFILE',
      merchantId,
      { merchantId }
    );

    return res.status(200).json({
      success: true,
      message: 'Merchant profile deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting merchant profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete merchant profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
