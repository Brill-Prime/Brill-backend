
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { verificationDocuments, users, auditLogs } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const uploadDocumentSchema = z.object({
  documentType: z.string().min(1, 'Document type is required'),
  documentNumber: z.string().optional(),
  fileName: z.string().min(1, 'File name is required'),
  fileSize: z.number().int().positive('File size must be positive').optional(),
  mimeType: z.string().optional(),
  expiryDate: z.string().optional(),
  extractedData: z.record(z.string(), z.any()).optional().default({})
});

const updateDocumentStatusSchema = z.object({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION']).optional(),
  validationScore: z.number().min(0).max(1).optional(),
  extractedData: z.record(z.string(), z.any()).optional(),
  rejectionReason: z.string().optional()
});

// Helper function to log audit actions
const logAuditAction = async (userId: number, action: string, entityId: number, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'VERIFICATION_DOCUMENT',
      entityId,
      details,
      ipAddress: '0.0.0.0',
      userAgent: 'API'
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

// POST /api/verification-documents - Upload a verification document
router.post('/', requireAuth, async (req, res) => {
  try {
    const validation = uploadDocumentSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.issues
      });
    }

    const { documentType, documentNumber, fileName, fileSize, mimeType, expiryDate, extractedData } = validation.data;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found'
      });
    }

    // Check if user already has a pending document of the same type
    const existingDocument = await db
      .select()
      .from(verificationDocuments)
      .where(
        and(
          eq(verificationDocuments.userId, userId),
          eq(verificationDocuments.documentType, documentType),
          eq(verificationDocuments.status, 'PENDING')
        )
      )
      .limit(1);

    if (existingDocument.length > 0) {
      return res.status(400).json({
        success: false,
        message: `You already have a pending ${documentType} document`
      });
    }

    // Create new verification document
    const [newDocument] = await db
      .insert(verificationDocuments)
      .values({
        userId,
        documentType,
        documentNumber,
        fileName,
        fileSize,
        mimeType,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        extractedData: extractedData || {},
        status: 'PENDING'
      })
      .returning();

    // Log audit action
    await logAuditAction(userId, 'VERIFICATION_DOCUMENT_UPLOADED', newDocument.id, {
      documentType,
      fileName,
      fileSize
    });

    res.status(201).json({
      success: true,
      message: 'Verification document uploaded successfully',
      data: {
        id: newDocument.id,
        documentType: newDocument.documentType,
        fileName: newDocument.fileName,
        status: newDocument.status,
        uploadedAt: newDocument.uploadedAt
      }
    });

  } catch (error) {
    console.error('Upload verification document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload verification document'
    });
  }
});

// GET /api/verification-documents - List all documents (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    // Get filters from query parameters
    const status = req.query.status as string;
    const documentType = req.query.documentType as string;
    const userId = req.query.userId as string;

    // Build where conditions
    let whereConditions = [];
    
    if (status && ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REQUIRES_RESUBMISSION'].includes(status)) {
      whereConditions.push(eq(verificationDocuments.status, status as any));
    }

    if (documentType) {
      whereConditions.push(eq(verificationDocuments.documentType, documentType));
    }

    if (userId) {
      whereConditions.push(eq(verificationDocuments.userId, parseInt(userId)));
    }

    const whereClause = whereConditions.length > 0 
      ? and(...whereConditions)
      : undefined;

    // Get documents with user details
    const documents = await db
      .select({
        id: verificationDocuments.id,
        userId: verificationDocuments.userId,
        documentType: verificationDocuments.documentType,
        documentNumber: verificationDocuments.documentNumber,
        fileName: verificationDocuments.fileName,
        fileSize: verificationDocuments.fileSize,
        mimeType: verificationDocuments.mimeType,
        status: verificationDocuments.status,
        validationScore: verificationDocuments.validationScore,
        extractedData: verificationDocuments.extractedData,
        rejectionReason: verificationDocuments.rejectionReason,
        expiryDate: verificationDocuments.expiryDate,
        uploadedAt: verificationDocuments.uploadedAt,
        reviewedAt: verificationDocuments.reviewedAt,
        reviewedBy: verificationDocuments.reviewedBy,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role
        }
      })
      .from(verificationDocuments)
      .leftJoin(users, eq(verificationDocuments.userId, users.id))
      .where(whereClause)
      .orderBy(desc(verificationDocuments.uploadedAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(verificationDocuments)
      .where(whereClause);

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: documents,
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
    console.error('Get verification documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verification documents'
    });
  }
});

// GET /api/verification-documents/user/:id - Get user's documents (Admin or own user)
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

    const userDocuments = await db
      .select({
        id: verificationDocuments.id,
        documentType: verificationDocuments.documentType,
        documentNumber: verificationDocuments.documentNumber,
        fileName: verificationDocuments.fileName,
        fileSize: verificationDocuments.fileSize,
        mimeType: verificationDocuments.mimeType,
        status: verificationDocuments.status,
        validationScore: verificationDocuments.validationScore,
        extractedData: verificationDocuments.extractedData,
        rejectionReason: verificationDocuments.rejectionReason,
        expiryDate: verificationDocuments.expiryDate,
        uploadedAt: verificationDocuments.uploadedAt,
        reviewedAt: verificationDocuments.reviewedAt
      })
      .from(verificationDocuments)
      .where(eq(verificationDocuments.userId, targetUserId))
      .orderBy(desc(verificationDocuments.uploadedAt));

    res.json({
      success: true,
      data: userDocuments
    });

  } catch (error) {
    console.error('Get user verification documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user verification documents'
    });
  }
});

// PUT /api/verification-documents/:id - Update document status (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const validation = updateDocumentStatusSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.issues
      });
    }

    const { status, validationScore, extractedData, rejectionReason } = validation.data;
    const adminUserId = req.user?.id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: 'Admin user ID not found'
      });
    }

    // Check if document exists
    const existingDocument = await db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    if (existingDocument.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Verification document not found'
      });
    }

    // Prepare update data
    const updateData: any = {
      reviewedAt: new Date(),
      reviewedBy: adminUserId,
      updatedAt: new Date()
    };

    if (status) {
      updateData.status = status;
    }

    if (validationScore !== undefined) {
      updateData.validationScore = validationScore.toString();
    }

    if (extractedData) {
      updateData.extractedData = extractedData;
    }

    if (rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    // Update document
    const [updatedDocument] = await db
      .update(verificationDocuments)
      .set(updateData)
      .where(eq(verificationDocuments.id, documentId))
      .returning();

    // Log audit action
    await logAuditAction(adminUserId, 'VERIFICATION_DOCUMENT_REVIEWED', documentId, {
      newStatus: status,
      validationScore,
      rejectionReason,
      reviewedBy: adminUserId
    });

    res.json({
      success: true,
      message: 'Verification document updated successfully',
      data: {
        id: updatedDocument.id,
        status: updatedDocument.status,
        validationScore: updatedDocument.validationScore,
        rejectionReason: updatedDocument.rejectionReason,
        reviewedAt: updatedDocument.reviewedAt,
        reviewedBy: updatedDocument.reviewedBy
      }
    });

  } catch (error) {
    console.error('Update verification document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update verification document'
    });
  }
});

// GET /api/verification-documents/:id - Get specific document (Admin or owner)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get document with user details
    const document = await db
      .select({
        id: verificationDocuments.id,
        userId: verificationDocuments.userId,
        documentType: verificationDocuments.documentType,
        documentNumber: verificationDocuments.documentNumber,
        fileName: verificationDocuments.fileName,
        fileSize: verificationDocuments.fileSize,
        mimeType: verificationDocuments.mimeType,
        status: verificationDocuments.status,
        validationScore: verificationDocuments.validationScore,
        extractedData: verificationDocuments.extractedData,
        rejectionReason: verificationDocuments.rejectionReason,
        expiryDate: verificationDocuments.expiryDate,
        uploadedAt: verificationDocuments.uploadedAt,
        reviewedAt: verificationDocuments.reviewedAt,
        reviewedBy: verificationDocuments.reviewedBy,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role
        }
      })
      .from(verificationDocuments)
      .leftJoin(users, eq(verificationDocuments.userId, users.id))
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    if (document.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Verification document not found'
      });
    }

    const documentData = document[0];

    // Check if user can access this data (admin or owner)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== documentData.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: documentData
    });

  } catch (error) {
    console.error('Get verification document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verification document'
    });
  }
});

// DELETE /api/verification-documents/:id - Delete document (Owner only or Admin)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if document exists and get owner info
    const [existingDocument] = await db
      .select()
      .from(verificationDocuments)
      .where(eq(verificationDocuments.id, documentId))
      .limit(1);

    if (!existingDocument) {
      return res.status(404).json({
        success: false,
        message: 'Verification document not found'
      });
    }

    // Check if user can delete this document (admin or owner)
    if (currentUser.role !== 'ADMIN' && currentUser.id !== existingDocument.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Soft delete by setting deletedAt timestamp
    await db
      .update(verificationDocuments)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(verificationDocuments.id, documentId));

    // Log audit action
    await logAuditAction(currentUser.id, 'VERIFICATION_DOCUMENT_DELETED', documentId, {
      documentType: existingDocument.documentType,
      fileName: existingDocument.fileName
    });

    res.json({
      success: true,
      message: 'Verification document deleted successfully'
    });

  } catch (error) {
    console.error('Delete verification document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete verification document'
    });
  }
});

export default router;
