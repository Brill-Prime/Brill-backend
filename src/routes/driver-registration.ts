
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { users, driverProfiles, identityVerifications, verificationDocuments, auditLogs } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { hashPassword } from '../utils/auth';
import { PasswordValidator } from '../utils/password-validator';

const router = express.Router();

// Validation schema for driver registration
const driverRegistrationSchema = z.object({
  // User information
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  phone: z.string().min(10, 'Valid phone number is required'),
  
  // Driver profile information
  vehicleType: z.string().min(2, 'Vehicle type is required'),
  vehiclePlate: z.string().min(3, 'Vehicle plate number is required'),
  vehicleModel: z.string().min(2, 'Vehicle model is required'),
  vehicleColor: z.string().min(2, 'Vehicle color is required'),
  
  // KYC/Verification information
  licenseNumber: z.string().min(3, 'License number is required'),
  licenseExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  vehicleRegistrationNumber: z.string().min(3, 'Vehicle registration number is required'),
  insuranceNumber: z.string().optional(),
  
  // Document URLs
  licenseImageUrl: z.string().url('Valid license image URL required'),
  vehicleRegistrationImageUrl: z.string().url('Valid registration image URL required'),
  insuranceImageUrl: z.string().url().optional(),
  profilePhotoUrl: z.string().url('Valid profile photo URL required'),
  
  // Consent
  backgroundCheckConsent: z.boolean().refine(val => val === true, 'Background check consent required'),
  termsAccepted: z.boolean().refine(val => val === true, 'Terms and conditions must be accepted')
});

// Helper function to log audit events
async function logAudit(userId: number, action: string, entityType: string, entityId?: number, details?: any, req?: any) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId: entityId ?? null,
      details,
      ipAddress: req?.ip || '0.0.0.0',
      userAgent: req?.headers['user-agent'] || 'API'
    });
  } catch (error) {
    console.error('Error logging audit event:', error);
  }
}

// POST /api/driver-registration - Complete driver registration with KYC
router.post('/', async (req, res) => {
  try {
    const validatedData = driverRegistrationSchema.parse(req.body);

    // 1. Validate password strength
    const passwordValidation = PasswordValidator.validate(validatedData.password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Password does not meet security requirements',
        errors: passwordValidation.errors,
        strength: passwordValidation.strength
      });
    }

    // 2. Check if password is compromised
    const isCompromised = await PasswordValidator.checkCompromised(validatedData.password);
    if (isCompromised) {
      return res.status(400).json({
        success: false,
        message: 'This password has been found in data breaches. Please choose a different password.'
      });
    }

    // 3. Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(and(
        eq(users.email, validatedData.email),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (existingUser.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    // 4. Check if vehicle plate is already registered
    const existingPlate = await db
      .select()
      .from(driverProfiles)
      .where(and(
        eq(driverProfiles.vehiclePlate, validatedData.vehiclePlate),
        isNull(driverProfiles.deletedAt)
      ))
      .limit(1);

    if (existingPlate.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This vehicle plate number is already registered'
      });
    }

    // 5. Hash password
    const passwordHash = await hashPassword(validatedData.password);

    // 6. Create user account
    const [newUser] = await db
      .insert(users)
      .values({
        email: validatedData.email,
        password: passwordHash,
        fullName: validatedData.fullName,
        phone: validatedData.phone,
        profilePicture: validatedData.profilePhotoUrl,
        role: 'DRIVER',
        isVerified: false,
        isActive: true,
        createdAt: new Date()
      })
      .returning();

    // 7. Create driver profile
    const [driverProfile] = await db
      .insert(driverProfiles)
      .values({
        userId: newUser.id,
        vehicleType: validatedData.vehicleType,
        vehiclePlate: validatedData.vehiclePlate,
        vehicleModel: validatedData.vehicleModel,
        vehicleColor: validatedData.vehicleColor,
        licenseNumber: validatedData.licenseNumber,
        vehicleRegistration: validatedData.vehicleRegistrationNumber,
        isOnline: false,
        isAvailable: false, // Not available until verified
        verificationStatus: 'PENDING',
        kycStatus: 'UNDER_REVIEW',
        kycSubmittedAt: new Date(),
        verificationLevel: 'BASIC',
        backgroundCheckStatus: 'PENDING',
        kycData: {
          licenseExpiryDate: validatedData.licenseExpiryDate,
          insuranceNumber: validatedData.insuranceNumber,
          backgroundCheckConsent: validatedData.backgroundCheckConsent,
          submittedAt: new Date().toISOString(),
          documents: {
            license: {
              number: validatedData.licenseNumber,
              imageUrl: validatedData.licenseImageUrl,
              expiryDate: validatedData.licenseExpiryDate
            },
            vehicleRegistration: {
              number: validatedData.vehicleRegistrationNumber,
              imageUrl: validatedData.vehicleRegistrationImageUrl
            },
            insurance: validatedData.insuranceNumber ? {
              number: validatedData.insuranceNumber,
              imageUrl: validatedData.insuranceImageUrl
            } : undefined,
            profilePhoto: validatedData.profilePhotoUrl
          }
        },
        createdAt: new Date()
      })
      .returning();

    // 8. Create identity verification record
    const [identityVerification] = await db
      .insert(identityVerifications)
      .values({
        userId: newUser.id,
        verificationType: 'DRIVER',
        data: {
          fullName: validatedData.fullName,
          phone: validatedData.phone,
          licenseNumber: validatedData.licenseNumber,
          licenseExpiryDate: validatedData.licenseExpiryDate,
          vehicleType: validatedData.vehicleType,
          vehiclePlate: validatedData.vehiclePlate,
          vehicleModel: validatedData.vehicleModel,
          vehicleColor: validatedData.vehicleColor,
          vehicleRegistrationNumber: validatedData.vehicleRegistrationNumber,
          insuranceNumber: validatedData.insuranceNumber,
          backgroundCheckConsent: validatedData.backgroundCheckConsent
        },
        status: 'PENDING',
        createdAt: new Date()
      })
      .returning();

    // 9. Store verification documents
    const documents = [
      {
        userId: newUser.id,
        documentType: 'DRIVERS_LICENSE',
        documentNumber: validatedData.licenseNumber,
        fileName: validatedData.licenseImageUrl,
        documentUrl: validatedData.licenseImageUrl,
        status: 'PENDING' as const,
        createdAt: new Date()
      },
      {
        userId: newUser.id,
        documentType: 'VEHICLE_REGISTRATION',
        documentNumber: validatedData.vehicleRegistrationNumber,
        fileName: validatedData.vehicleRegistrationImageUrl,
        documentUrl: validatedData.vehicleRegistrationImageUrl,
        status: 'PENDING' as const,
        createdAt: new Date()
      },
      {
        userId: newUser.id,
        documentType: 'SELFIE',
        documentNumber: null,
        fileName: validatedData.profilePhotoUrl,
        documentUrl: validatedData.profilePhotoUrl,
        status: 'PENDING' as const,
        createdAt: new Date()
      }
    ];

    if (validatedData.insuranceImageUrl) {
      documents.push({
        userId: newUser.id,
        documentType: 'INSURANCE_CERTIFICATE',
        documentNumber: validatedData.insuranceNumber || null,
        fileName: validatedData.insuranceImageUrl,
        documentUrl: validatedData.insuranceImageUrl,
        status: 'PENDING' as const,
        createdAt: new Date()
      });
    }

    await db.insert(verificationDocuments).values(documents);

    // 10. Log audit events
    await logAudit(
      newUser.id,
      'DRIVER_REGISTERED',
      'USER',
      newUser.id,
      { 
        email: validatedData.email,
        vehiclePlate: validatedData.vehiclePlate,
        vehicleType: validatedData.vehicleType
      },
      req
    );

    await logAudit(
      newUser.id,
      'DRIVER_PROFILE_CREATED',
      'DRIVER_PROFILE',
      driverProfile.id,
      { 
        vehiclePlate: validatedData.vehiclePlate,
        vehicleType: validatedData.vehicleType
      },
      req
    );

    await logAudit(
      newUser.id,
      'DRIVER_VERIFICATION_SUBMITTED',
      'DRIVER_PROFILE',
      driverProfile.id,
      { 
        documentTypes: ['LICENSE', 'REGISTRATION', 'INSURANCE', 'PHOTO'],
        verificationId: identityVerification.id
      },
      req
    );

    // 11. Return success response
    res.status(201).json({
      success: true,
      message: 'Driver registration successful. Your account is pending verification. You will be notified within 24-48 hours.',
      data: {
        userId: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        phone: newUser.phone,
        role: newUser.role,
        driverProfile: {
          id: driverProfile.id,
          vehicleType: driverProfile.vehicleType,
          vehiclePlate: driverProfile.vehiclePlate,
          vehicleModel: driverProfile.vehicleModel,
          verificationStatus: driverProfile.verificationStatus,
          kycStatus: driverProfile.kycStatus
        },
        verification: {
          status: 'PENDING',
          submittedAt: driverProfile.kycSubmittedAt,
          estimatedReviewTime: '24-48 hours'
        },
        nextSteps: [
          'Wait for admin review of your documents',
          'Check your email for verification updates',
          'You will be notified once your account is approved',
          'After approval, you can start accepting delivery orders'
        ]
      }
    });

  } catch (error) {
    console.error('Driver registration error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete driver registration. Please try again.'
    });
  }
});

// GET /api/driver-registration/requirements - Get driver registration requirements
router.get('/requirements', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        personalInfo: {
          fields: [
            { name: 'email', type: 'email', required: true, description: 'Valid email address' },
            { name: 'password', type: 'password', required: true, description: 'Minimum 8 characters, must include uppercase, lowercase, number, and special character' },
            { name: 'fullName', type: 'string', required: true, description: 'Full legal name as on ID' },
            { name: 'phone', type: 'string', required: true, description: 'Valid phone number with country code' }
          ]
        },
        vehicleInfo: {
          fields: [
            { name: 'vehicleType', type: 'string', required: true, description: 'Type of vehicle (e.g., Car, Motorcycle, Van)' },
            { name: 'vehiclePlate', type: 'string', required: true, description: 'Vehicle registration plate number' },
            { name: 'vehicleModel', type: 'string', required: true, description: 'Vehicle make and model' },
            { name: 'vehicleColor', type: 'string', required: true, description: 'Vehicle color' }
          ]
        },
        documents: {
          required: [
            { type: 'DRIVERS_LICENSE', description: 'Valid driver\'s license', fields: ['licenseNumber', 'licenseExpiryDate', 'licenseImageUrl'] },
            { type: 'VEHICLE_REGISTRATION', description: 'Vehicle registration certificate', fields: ['vehicleRegistrationNumber', 'vehicleRegistrationImageUrl'] },
            { type: 'PROFILE_PHOTO', description: 'Clear photo of yourself', fields: ['profilePhotoUrl'] }
          ],
          optional: [
            { type: 'INSURANCE_CERTIFICATE', description: 'Vehicle insurance certificate', fields: ['insuranceNumber', 'insuranceImageUrl'] }
          ]
        },
        consent: {
          required: [
            { name: 'backgroundCheckConsent', description: 'Consent to background check' },
            { name: 'termsAccepted', description: 'Accept terms and conditions' }
          ]
        },
        imageRequirements: {
          formats: ['JPEG', 'PNG', 'PDF'],
          maxSize: '5MB per file',
          quality: 'Clear, readable, not blurry'
        },
        reviewProcess: {
          estimatedTime: '24-48 hours',
          steps: [
            'Document verification',
            'Background check',
            'Vehicle inspection (if required)',
            'Final approval'
          ]
        }
      }
    });
  } catch (error) {
    console.error('Get requirements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch registration requirements'
    });
  }
});

export default router;
