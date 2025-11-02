import express from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { identityVerifications, verificationDocuments, auditLogs } from '../db/schema';
import { requireAuth } from '../middleware/auth';
import * as z from 'zod';

const router = express.Router();

// Helper function to log audit events
async function logAudit(userId: number, action: string, entityType: string, entityId?: number, details?: any) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId: entityId?.toString(),
      details,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('Error logging audit event:', error);
  }
}

// Validation schemas
const personalInfoSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
  nationality: z.string().min(2, 'Nationality is required'),
  idType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD']),
  idNumber: z.string().min(3, 'ID number is required')
});

const businessInfoSchema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  businessType: z.enum(['SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_LIABILITY', 'CORPORATION', 'OTHER']),
  registrationNumber: z.string().min(3, 'Registration number is required'),
  taxId: z.string().optional(),
  businessAddress: z.string().min(5, 'Business address is required'),
  businessPhone: z.string().min(5, 'Business phone is required'),
  businessEmail: z.string().email('Valid business email is required'),
  businessCategory: z.string().min(2, 'Business category is required')
});

const driverInfoSchema = z.object({
  licenseNumber: z.string().min(3, 'License number is required'),
  licenseExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  vehicleType: z.enum(['CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'OTHER']),
  vehicleMake: z.string().min(2, 'Vehicle make is required'),
  vehicleModel: z.string().min(2, 'Vehicle model is required'),
  vehicleYear: z.number().int().min(1900).max(new Date().getFullYear() + 1),
  vehicleColor: z.string().min(2, 'Vehicle color is required'),
  vehiclePlateNumber: z.string().min(2, 'Vehicle plate number is required')
});

// GET /api/kyc/profile - Get user's KYC profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const verifications = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .orderBy(desc(identityVerifications.createdAt))
      .limit(1);

    const documents = await db
      .select()
      .from(verificationDocuments)
      .where(and(
        eq(verificationDocuments.userId, userId),
        isNull(verificationDocuments.deletedAt)
      ))
      .orderBy(desc(verificationDocuments.createdAt));

    res.json({
      success: true,
      data: {
        userId,
        verificationStatus: verifications[0]?.status || 'PENDING',
        documents: documents.map(doc => ({
          id: doc.id,
          documentType: doc.documentType,
          status: doc.status,
          uploadedAt: doc.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Get KYC profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get KYC profile' });
  }
});

// POST /api/kyc/personal-info - Submit personal KYC information
router.post('/personal-info', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = personalInfoSchema.parse(req.body);

    // Check if user already has a verification record
    const existingVerification = await db
      .select()
      .from(identityVerifications)
      .where(and(
        eq(identityVerifications.userId, userId),
        eq(identityVerifications.verificationType, 'PERSONAL')
      ))
      .limit(1);

    let verificationId;

    if (existingVerification.length > 0) {
      // Update existing verification
      await db
        .update(identityVerifications)
        .set({
          data: { ...validatedData },
          status: 'PENDING_REVIEW',
          updatedAt: new Date()
        })
        .where(eq(identityVerifications.id, existingVerification[0].id));

      verificationId = existingVerification[0].id;
    } else {
      // Create new verification
      const [newVerification] = await db
        .insert(identityVerifications)
        .values({
          userId,
          verificationType: 'PERSONAL',
          data: { ...validatedData },
          status: 'PENDING_REVIEW',
          createdAt: new Date()
        })
        .returning();

      verificationId = newVerification.id;
    }

    // Log audit event
    await logAudit(
      userId,
      'SUBMIT_PERSONAL_KYC',
      'IDENTITY_VERIFICATION',
      verificationId,
      { verificationType: 'PERSONAL' }
    );

    return res.status(200).json({
      success: true,
      message: 'Personal information submitted successfully',
      data: {
        verificationId,
        status: 'PENDING_REVIEW'
      }
    });
  } catch (error) {
    console.error('Submit personal KYC error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to submit personal information',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/kyc/business-info - Submit business KYC information
router.post('/business-info', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = businessInfoSchema.parse(req.body);

    // Check if user already has a business verification record
    const existingVerification = await db
      .select()
      .from(identityVerifications)
      .where(and(
        eq(identityVerifications.userId, userId),
        eq(identityVerifications.verificationType, 'BUSINESS')
      ))
      .limit(1);

    let verificationId;

    if (existingVerification.length > 0) {
      // Update existing verification
      await db
        .update(identityVerifications)
        .set({
          data: { ...validatedData },
          status: 'PENDING_REVIEW',
          updatedAt: new Date()
        })
        .where(eq(identityVerifications.id, existingVerification[0].id));

      verificationId = existingVerification[0].id;
    } else {
      // Create new verification
      const [newVerification] = await db
        .insert(identityVerifications)
        .values({
          userId,
          verificationType: 'BUSINESS',
          data: { ...validatedData },
          status: 'PENDING_REVIEW',
          createdAt: new Date()
        })
        .returning();

      verificationId = newVerification.id;
    }

    // Log audit event
    await logAudit(
      userId,
      'SUBMIT_BUSINESS_KYC',
      'IDENTITY_VERIFICATION',
      verificationId,
      { verificationType: 'BUSINESS' }
    );

    return res.status(200).json({
      success: true,
      message: 'Business information submitted successfully',
      data: {
        verificationId,
        status: 'PENDING_REVIEW'
      }
    });
  } catch (error) {
    console.error('Submit business KYC error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to submit business information',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/kyc/driver-info - Submit driver KYC information
router.post('/driver-info', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = driverInfoSchema.parse(req.body);

    // Check if user already has a driver verification record
    const existingVerification = await db
      .select()
      .from(identityVerifications)
      .where(and(
        eq(identityVerifications.userId, userId),
        eq(identityVerifications.verificationType, 'DRIVER')
      ))
      .limit(1);

    let verificationId;

    if (existingVerification.length > 0) {
      // Update existing verification
      await db
        .update(identityVerifications)
        .set({
          data: { ...validatedData },
          status: 'PENDING_REVIEW',
          updatedAt: new Date()
        })
        .where(eq(identityVerifications.id, existingVerification[0].id));

      verificationId = existingVerification[0].id;
    } else {
      // Create new verification
      const [newVerification] = await db
        .insert(identityVerifications)
        .values({
          userId,
          verificationType: 'DRIVER',
          data: { ...validatedData },
          status: 'PENDING_REVIEW',
          createdAt: new Date()
        })
        .returning();

      verificationId = newVerification.id;
    }

    // Log audit event
    await logAudit(
      userId,
      'SUBMIT_DRIVER_KYC',
      'IDENTITY_VERIFICATION',
      verificationId,
      { verificationType: 'DRIVER' }
    );

    return res.status(200).json({
      success: true,
      message: 'Driver information submitted successfully',
      data: {
        verificationId,
        status: 'PENDING_REVIEW'
      }
    });
  } catch (error) {
    console.error('Submit driver KYC error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to submit driver information',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/kyc/requirements - Get KYC requirements based on user role
router.get('/requirements', requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const role = req.query.role?.toString() || user.role;

    // Define requirements based on role
    const requirements = {
      CUSTOMER: {
        personal: {
          required: true,
          fields: [
            { name: 'fullName', type: 'string', required: true },
            { name: 'dateOfBirth', type: 'date', required: true },
            { name: 'gender', type: 'enum', required: true, options: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] },
            { name: 'nationality', type: 'string', required: true },
            { name: 'idType', type: 'enum', required: true, options: ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'] },
            { name: 'idNumber', type: 'string', required: true }
          ],
          documents: [
            { type: 'ID_FRONT', required: true, description: 'Front of ID card/passport' },
            { type: 'ID_BACK', required: true, description: 'Back of ID card' },
            { type: 'SELFIE', required: true, description: 'Selfie with ID' }
          ]
        },
        business: {
          required: false
        },
        driver: {
          required: false
        }
      },
      MERCHANT: {
        personal: {
          required: true,
          fields: [
            { name: 'fullName', type: 'string', required: true },
            { name: 'dateOfBirth', type: 'date', required: true },
            { name: 'gender', type: 'enum', required: true, options: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] },
            { name: 'nationality', type: 'string', required: true },
            { name: 'idType', type: 'enum', required: true, options: ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'] },
            { name: 'idNumber', type: 'string', required: true }
          ],
          documents: [
            { type: 'ID_FRONT', required: true, description: 'Front of ID card/passport' },
            { type: 'ID_BACK', required: true, description: 'Back of ID card' },
            { type: 'SELFIE', required: true, description: 'Selfie with ID' }
          ]
        },
        business: {
          required: true,
          fields: [
            { name: 'businessName', type: 'string', required: true },
            { name: 'businessType', type: 'enum', required: true, options: ['SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_LIABILITY', 'CORPORATION', 'OTHER'] },
            { name: 'registrationNumber', type: 'string', required: true },
            { name: 'taxId', type: 'string', required: false },
            { name: 'businessAddress', type: 'string', required: true },
            { name: 'businessPhone', type: 'string', required: true },
            { name: 'businessEmail', type: 'string', required: true },
            { name: 'businessCategory', type: 'string', required: true }
          ],
          documents: [
            { type: 'BUSINESS_REGISTRATION', required: true, description: 'Business registration certificate' },
            { type: 'TAX_CERTIFICATE', required: false, description: 'Tax registration certificate' },
            { type: 'BUSINESS_PERMIT', required: true, description: 'Business operating permit' }
          ]
        },
        driver: {
          required: false
        }
      },
      DRIVER: {
        personal: {
          required: true,
          fields: [
            { name: 'fullName', type: 'string', required: true },
            { name: 'dateOfBirth', type: 'date', required: true },
            { name: 'gender', type: 'enum', required: true, options: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] },
            { name: 'nationality', type: 'string', required: true },
            { name: 'idType', type: 'enum', required: true, options: ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'] },
            { name: 'idNumber', type: 'string', required: true }
          ],
          documents: [
            { type: 'ID_FRONT', required: true, description: 'Front of ID card/passport' },
            { type: 'ID_BACK', required: true, description: 'Back of ID card' },
            { type: 'SELFIE', required: true, description: 'Selfie with ID' }
          ]
        },
        business: {
          required: false
        },
        driver: {
          required: true,
          fields: [
            { name: 'licenseNumber', type: 'string', required: true },
            { name: 'licenseExpiryDate', type: 'date', required: true },
            { name: 'vehicleType', type: 'enum', required: true, options: ['CAR', 'MOTORCYCLE', 'TRUCK', 'VAN', 'OTHER'] },
            { name: 'vehicleMake', type: 'string', required: true },
            { name: 'vehicleModel', type: 'string', required: true },
            { name: 'vehicleYear', type: 'number', required: true },
            { name: 'vehicleColor', type: 'string', required: true },
            { name: 'vehiclePlateNumber', type: 'string', required: true }
          ],
          documents: [
            { type: 'DRIVERS_LICENSE_FRONT', required: true, description: 'Front of driver\'s license' },
            { type: 'DRIVERS_LICENSE_BACK', required: true, description: 'Back of driver\'s license' },
            { type: 'VEHICLE_REGISTRATION', required: true, description: 'Vehicle registration document' },
            { type: 'VEHICLE_INSURANCE', required: true, description: 'Vehicle insurance certificate' },
            { type: 'VEHICLE_PHOTO', required: true, description: 'Photo of vehicle' }
          ]
        }
      }
    };

    // Get requirements for the specified role
    const roleRequirements = requirements[role as keyof typeof requirements] || requirements.CUSTOMER;

    return res.status(200).json({
      success: true,
      data: roleRequirements
    });
  } catch (error) {
    console.error('Get KYC requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get KYC requirements',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/kyc/documents - Upload verification document
router.post('/documents', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { documentType, documentNumber, documentUrl } = req.body;

    if (!documentType || !documentUrl) {
      return res.status(400).json({
        success: false,
        message: 'Document type and URL are required'
      });
    }

    const [newDocument] = await db
      .insert(verificationDocuments)
      .values({
        userId,
        documentType,
        documentNumber,
        documentUrl,
        status: 'PENDING'
      })
      .returning();

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        id: newDocument.id,
        documentType: newDocument.documentType,
        status: newDocument.status,
        uploadedAt: newDocument.uploadedAt
      }
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
});

// DELETE /api/kyc/documents/:id - Delete verification document
router.delete('/documents/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const documentId = parseInt(req.params.id);

    if (isNaN(documentId)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID' });
    }

    const [document] = await db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (document.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await db
      .update(verificationDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(verificationDocuments.id, documentId));

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete document' });
  }
});

// POST /api/kyc/submit - Submit KYC for verification
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { documentType, documentNumber, documentImageUrl } = req.body;

    if (!documentType || !documentNumber) {
      return res.status(400).json({
        success: false,
        message: 'Document type and number are required'
      });
    }

    const [verification] = await db
      .insert(identityVerifications)
      .values({
        userId,
        verificationType: documentType,
        verificationData: {
          documentType,
          documentNumber,
          documentImageUrl,
          submittedAt: new Date().toISOString()
        },
        status: 'PENDING'
      })
      .returning();

    res.json({
      success: true,
      message: 'KYC submitted for verification',
      data: verification
    });
  } catch (error) {
    console.error('Submit KYC error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit KYC' });
  }
});

// GET /api/kyc/status - Get KYC verification status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [verification] = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .orderBy(desc(identityVerifications.createdAt))
      .limit(1);

    res.json({
      success: true,
      data: {
        status: verification?.status || 'PENDING',
        submittedAt: verification?.createdAt || null,
        verifiedAt: verification?.verifiedAt || null
      }
    });
  } catch (error) {
    console.error('Get KYC status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get KYC status' });
  }
});

export default router;