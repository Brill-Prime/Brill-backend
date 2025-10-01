
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { driverProfiles, users, auditLogs, verificationDocuments } from '../db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const submitDocumentsSchema = z.object({
  licenseNumber: z.string().min(1, 'License number is required'),
  licenseImageUrl: z.string().url('Valid license image URL required'),
  vehicleRegistrationNumber: z.string().min(1, 'Vehicle registration required'),
  vehicleRegistrationImageUrl: z.string().url('Valid registration image URL required'),
  insuranceNumber: z.string().min(1, 'Insurance number required'),
  insuranceImageUrl: z.string().url('Valid insurance image URL required'),
  profilePhotoUrl: z.string().url('Valid profile photo URL required'),
  backgroundCheckConsent: z.boolean().refine(val => val === true, 'Background check consent required')
});

const verificationDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION']),
  rejectionReason: z.string().optional(),
  additionalRequirements: z.string().optional()
});

// POST /api/driver-verification/submit - Submit verification documents
router.post('/submit', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const driverId = req.user!.id;
    const validatedData = submitDocumentsSchema.parse(req.body);

    // Check if driver profile exists
    const [driverProfile] = await db
      .select()
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.userId, driverId),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (!driverProfile) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Update driver profile with verification data
    await db
      .update(driverProfiles)
      .set({
        licenseNumber: validatedData.licenseNumber,
        vehicleRegistration: validatedData.vehicleRegistrationNumber,
        verificationStatus: 'PENDING',
        kycStatus: 'UNDER_REVIEW',
        kycSubmittedAt: new Date(),
        kycData: {
          ...driverProfile.kycData,
          documents: {
            license: {
              number: validatedData.licenseNumber,
              imageUrl: validatedData.licenseImageUrl
            },
            vehicleRegistration: {
              number: validatedData.vehicleRegistrationNumber,
              imageUrl: validatedData.vehicleRegistrationImageUrl
            },
            insurance: {
              number: validatedData.insuranceNumber,
              imageUrl: validatedData.insuranceImageUrl
            },
            profilePhoto: validatedData.profilePhotoUrl,
            backgroundCheckConsent: validatedData.backgroundCheckConsent,
            submittedAt: new Date().toISOString()
          }
        }
      })
      .where(eq(driverProfiles.id, driverProfile.id));

    // Store verification documents
    await db.insert(verificationDocuments).values([
      {
        userId: driverId,
        documentType: 'DRIVERS_LICENSE',
        documentNumber: validatedData.licenseNumber,
        documentImageUrl: validatedData.licenseImageUrl,
        verificationStatus: 'PENDING'
      },
      {
        userId: driverId,
        documentType: 'VEHICLE_REGISTRATION',
        documentNumber: validatedData.vehicleRegistrationNumber,
        documentImageUrl: validatedData.vehicleRegistrationImageUrl,
        verificationStatus: 'PENDING'
      },
      {
        userId: driverId,
        documentType: 'INSURANCE_CERTIFICATE',
        documentNumber: validatedData.insuranceNumber,
        documentImageUrl: validatedData.insuranceImageUrl,
        verificationStatus: 'PENDING'
      }
    ]);

    // Log audit event
    await db.insert(auditLogs).values({
      userId: driverId,
      action: 'DRIVER_VERIFICATION_SUBMITTED',
      entityType: 'DRIVER_PROFILE',
      entityId: driverProfile.id,
      details: { documentTypes: ['LICENSE', 'REGISTRATION', 'INSURANCE'] },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: 'Verification documents submitted successfully. Review typically takes 24-48 hours.',
      verificationStatus: 'UNDER_REVIEW'
    });
  } catch (error) {
    console.error('Submit verification error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to submit verification documents'
    });
  }
});

// GET /api/driver-verification/status - Get verification status
router.get('/status', requireAuth, requireRole(['DRIVER']), async (req, res) => {
  try {
    const driverId = req.user!.id;

    const [driverProfile] = await db
      .select({
        verificationStatus: driverProfiles.verificationStatus,
        kycStatus: driverProfiles.kycStatus,
        kycSubmittedAt: driverProfiles.kycSubmittedAt,
        kycApprovedAt: driverProfiles.kycApprovedAt,
        kycData: driverProfiles.kycData,
        backgroundCheckStatus: driverProfiles.backgroundCheckStatus
      })
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.userId, driverId),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (!driverProfile) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Get verification documents
    const documents = await db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.userId, driverId))
      .orderBy(desc(verificationDocuments.createdAt));

    res.json({
      success: true,
      data: {
        verificationStatus: driverProfile.verificationStatus,
        kycStatus: driverProfile.kycStatus,
        backgroundCheckStatus: driverProfile.backgroundCheckStatus,
        submittedAt: driverProfile.kycSubmittedAt,
        approvedAt: driverProfile.kycApprovedAt,
        documents: documents.map(doc => ({
          type: doc.documentType,
          status: doc.verificationStatus,
          rejectionReason: doc.rejectionReason,
          submittedAt: doc.createdAt
        })),
        nextSteps: getNextSteps(driverProfile.verificationStatus, driverProfile.kycStatus)
      }
    });
  } catch (error) {
    console.error('Get verification status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get verification status'
    });
  }
});

// GET /api/driver-verification/pending - Get pending verifications (Admin only)
router.get('/pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pendingVerifications = await db
      .select({
        driverId: driverProfiles.userId,
        profileId: driverProfiles.id,
        verificationStatus: driverProfiles.verificationStatus,
        kycStatus: driverProfiles.kycStatus,
        submittedAt: driverProfiles.kycSubmittedAt,
        kycData: driverProfiles.kycData,
        driver: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone
        }
      })
      .from(driverProfiles)
      .innerJoin(users, eq(driverProfiles.userId, users.id))
      .where(and(
        eq(driverProfiles.verificationStatus, 'PENDING'),
        eq(driverProfiles.kycStatus, 'UNDER_REVIEW'),
        isNull(driverProfiles.deletedAt)
      ))
      .orderBy(desc(driverProfiles.kycSubmittedAt));

    res.json({
      success: true,
      data: pendingVerifications,
      count: pendingVerifications.length
    });
  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending verifications'
    });
  }
});

// POST /api/driver-verification/:driverId/decision - Make verification decision (Admin only)
router.post('/:driverId/decision', requireAuth, requireAdmin, async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    const adminId = req.user!.id;
    const validatedData = verificationDecisionSchema.parse(req.body);

    if (isNaN(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID'
      });
    }

    // Get driver profile
    const [driverProfile] = await db
      .select()
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.userId, driverId),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (!driverProfile) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    // Update verification status
    const updateData: any = {
      verificationStatus: validatedData.status,
      kycStatus: validatedData.status,
      kycApprovedBy: adminId,
      updatedAt: new Date()
    };

    if (validatedData.status === 'APPROVED') {
      updateData.kycApprovedAt = new Date();
      updateData.backgroundCheckStatus = 'APPROVED';
      updateData.tier = 'STANDARD';
    }

    await db
      .update(driverProfiles)
      .set(updateData)
      .where(eq(driverProfiles.id, driverProfile.id));

    // Update verification documents
    const documentStatus = validatedData.status === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    await db
      .update(verificationDocuments)
      .set({
        verificationStatus: documentStatus,
        rejectionReason: validatedData.rejectionReason,
        reviewedAt: new Date(),
        reviewedBy: adminId
      })
      .where(eq(verificationDocuments.userId, driverId));

    // Log audit event
    await db.insert(auditLogs).values({
      userId: adminId,
      action: 'DRIVER_VERIFICATION_REVIEWED',
      entityType: 'DRIVER_PROFILE',
      entityId: driverProfile.id,
      details: {
        decision: validatedData.status,
        rejectionReason: validatedData.rejectionReason,
        driverId
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: `Driver verification ${validatedData.status.toLowerCase()} successfully`,
      decision: validatedData.status
    });
  } catch (error) {
    console.error('Verification decision error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to process verification decision'
    });
  }
});

// Helper function to determine next steps
function getNextSteps(verificationStatus: string, kycStatus: string): string[] {
  const steps = [];
  
  if (verificationStatus === 'PENDING') {
    if (kycStatus === 'PENDING') {
      steps.push('Submit required documents for verification');
    } else if (kycStatus === 'UNDER_REVIEW') {
      steps.push('Wait for admin review (24-48 hours)');
      steps.push('Check email for updates');
    }
  } else if (verificationStatus === 'REJECTED') {
    steps.push('Review rejection reasons');
    steps.push('Resubmit corrected documents');
  } else if (verificationStatus === 'REQUIRES_RESUBMISSION') {
    steps.push('Check additional requirements');
    steps.push('Submit missing or corrected documents');
  } else if (verificationStatus === 'APPROVED') {
    steps.push('Start accepting delivery orders');
    steps.push('Complete driver onboarding');
    steps.push('Download driver mobile app');
  }
  
  return steps;
}

export default router;
