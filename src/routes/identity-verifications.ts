
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { identityVerifications, users, auditLogs } from '../db/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createIdentityVerificationSchema = z.object({
  documentType: z.string().min(1, 'Document type is required'),
  documentNumber: z.string().min(1, 'Document number is required'),
  documentImageUrl: z.string().url('Valid image URL is required').optional()
});

const updateIdentityVerificationSchema = z.object({
  verificationStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  rejectionReason: z.string().optional()
});

// Helper function to log audit actions
const logAuditAction = async (userId: number, action: string, entityId: number, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'IDENTITY_VERIFICATION',
      entityId,
      details,
      ipAddress: '0.0.0.0', // You can get this from req.ip if needed
      userAgent: 'API'
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

// POST /api/identity-verifications - Submit identity verification
router.post('/', requireAuth, async (req, res) => {
  try {
    const validation = createIdentityVerificationSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.issues
      });
    }

    const { documentType, documentNumber, documentImageUrl } = validation.data;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found'
      });
    }

    // Check if user already has a pending or approved verification
    const existingVerification = await db
      .select()
      .from(identityVerifications)
      .where(
        and(
          eq(identityVerifications.userId, userId),
          eq(identityVerifications.verificationStatus, 'PENDING'),
          isNull(identityVerifications.deletedAt)
        )
      )
      .limit(1);

    if (existingVerification.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending verification request'
      });
    }

    // Create new identity verification
    const [newVerification] = await db
      .insert(identityVerifications)
      .values({
        userId,
        documentType,
        documentNumber,
        documentImageUrl,
        verificationStatus: 'PENDING',
        submittedAt: new Date()
      })
      .returning();

    // Log audit action
    await logAuditAction(userId, 'IDENTITY_VERIFICATION_SUBMITTED', newVerification.id, {
      documentType,
      documentNumber: documentNumber.substring(0, 4) + '****' // Partially mask for security
    });

    res.status(201).json({
      success: true,
      message: 'Identity verification submitted successfully',
      data: {
        id: newVerification.id,
        documentType: newVerification.documentType,
        verificationStatus: newVerification.verificationStatus,
        submittedAt: newVerification.submittedAt
      }
    });

  } catch (error) {
    console.error('Create identity verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit identity verification'
    });
  }
});

// GET /api/identity-verifications - List all verifications (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    // Get filters from query parameters
    const status = req.query.status as string;
    const documentType = req.query.documentType as string;

    // Build where conditions
    let whereConditions = [];
    
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      whereConditions.push(eq(identityVerifications.verificationStatus, status as any));
    }

    if (documentType) {
      whereConditions.push(eq(identityVerifications.documentType, documentType));
    }

    const whereClause = whereConditions.length > 0 
      ? and(...whereConditions)
      : undefined;

    // Get verifications with user details
    const verifications = await db
      .select({
        id: identityVerifications.id,
        userId: identityVerifications.userId,
        documentType: identityVerifications.documentType,
        documentNumber: identityVerifications.documentNumber,
        documentImageUrl: identityVerifications.documentImageUrl,
        verificationStatus: identityVerifications.verificationStatus,
        rejectionReason: identityVerifications.rejectionReason,
        submittedAt: identityVerifications.submittedAt,
        reviewedAt: identityVerifications.reviewedAt,
        reviewedBy: identityVerifications.reviewedBy,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role
        }
      })
      .from(identityVerifications)
      .leftJoin(users, eq(identityVerifications.userId, users.id))
      .where(whereClause)
      .orderBy(desc(identityVerifications.submittedAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(identityVerifications)
      .where(whereClause);

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: verifications.map(v => ({
        ...v,
        documentNumber: v.documentNumber ? v.documentNumber.substring(0, 4) + '****' : null // Mask for security
      })),
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: count,
        itemsPerPage: limit,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get identity verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch identity verifications'
    });
  }
});

// GET /api/identity-verifications/user/:id - Get user's verifications (Admin or own user)
router.get('/user/:id', requireAuth, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user can access this data (admin or own data)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== targetUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const userVerifications = await db
      .select({
        id: identityVerifications.id,
        documentType: identityVerifications.documentType,
        documentNumber: identityVerifications.documentNumber,
        documentImageUrl: identityVerifications.documentImageUrl,
        verificationStatus: identityVerifications.verificationStatus,
        rejectionReason: identityVerifications.rejectionReason,
        submittedAt: identityVerifications.submittedAt,
        reviewedAt: identityVerifications.reviewedAt
      })
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, targetUserId))
      .orderBy(desc(identityVerifications.submittedAt));

    res.json({
      success: true,
      data: userVerifications.map(v => ({
        ...v,
        documentNumber: currentUser.role === 'ADMIN' ? v.documentNumber : 
                       (v.documentNumber ? v.documentNumber.substring(0, 4) + '****' : null)
      }))
    });

  } catch (error) {
    console.error('Get user identity verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user identity verifications'
    });
  }
});

// PUT /api/identity-verifications/:id - Update verification status (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const verificationId = parseInt(req.params.id);
    const validation = updateIdentityVerificationSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.issues
      });
    }

    const { verificationStatus, rejectionReason } = validation.data;
    const adminUserId = req.user?.id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: 'Admin user ID not found'
      });
    }

    // Check if verification exists
    const existingVerification = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, verificationId))
      .limit(1);

    if (existingVerification.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Identity verification not found'
      });
    }

    // Prepare update data
    const updateData: any = {
      reviewedAt: new Date(),
      reviewedBy: adminUserId
    };

    if (verificationStatus) {
      updateData.verificationStatus = verificationStatus;
    }

    if (rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    // Update verification
    const [updatedVerification] = await db
      .update(identityVerifications)
      .set(updateData)
      .where(eq(identityVerifications.id, verificationId))
      .returning();

    // Log audit action
    await logAuditAction(adminUserId, 'IDENTITY_VERIFICATION_REVIEWED', verificationId, {
      newStatus: verificationStatus,
      rejectionReason,
      reviewedBy: adminUserId
    });

    res.json({
      success: true,
      message: 'Identity verification updated successfully',
      data: {
        id: updatedVerification.id,
        verificationStatus: updatedVerification.verificationStatus,
        rejectionReason: updatedVerification.rejectionReason,
        reviewedAt: updatedVerification.reviewedAt,
        reviewedBy: updatedVerification.reviewedBy
      }
    });

  } catch (error) {
    console.error('Update identity verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update identity verification'
    });
  }
});

// GET /api/identity-verifications/:id - Get specific verification (Admin or owner)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const verificationId = parseInt(req.params.id);
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get verification with user details
    const verification = await db
      .select({
        id: identityVerifications.id,
        userId: identityVerifications.userId,
        documentType: identityVerifications.documentType,
        documentNumber: identityVerifications.documentNumber,
        documentImageUrl: identityVerifications.documentImageUrl,
        verificationStatus: identityVerifications.verificationStatus,
        rejectionReason: identityVerifications.rejectionReason,
        submittedAt: identityVerifications.submittedAt,
        reviewedAt: identityVerifications.reviewedAt,
        reviewedBy: identityVerifications.reviewedBy,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role
        }
      })
      .from(identityVerifications)
      .leftJoin(users, eq(identityVerifications.userId, users.id))
      .where(eq(identityVerifications.id, verificationId))
      .limit(1);

    if (verification.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Identity verification not found'
      });
    }

    const verificationData = verification[0];

    // Check if user can access this data (admin or owner)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== verificationData.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: {
        ...verificationData,
        documentNumber: currentUser.role === 'ADMIN' ? verificationData.documentNumber : 
                       (verificationData.documentNumber ? verificationData.documentNumber.substring(0, 4) + '****' : null)
      }
    });

  } catch (error) {
    console.error('Get identity verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch identity verification'
    });
  }
});

export default router;
