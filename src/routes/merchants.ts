
import express from 'express';
import { db } from '../db/config';
import { merchantProfiles, users, auditLogs } from '../db/schema';
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
        errors: error.errors
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
        errors: error.errors
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

export default router;
