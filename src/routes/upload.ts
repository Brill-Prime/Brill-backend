
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';
import { db } from '../db/config';
import { auditLogs } from '../db/schema';

const router = express.Router();

// Validation schemas
const uploadMetadataSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().positive(),
  mimeType: z.string().min(1),
  purpose: z.enum(['profile', 'product', 'document', 'verification', 'other']),
  description: z.string().optional()
});

// Helper function to log upload activity
const logUploadActivity = async (userId: number, action: string, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'FILE_UPLOAD',
      details
    });
  } catch (error) {
    console.error('Failed to log upload activity:', error);
  }
};

// POST /api/upload/presigned-url - Get presigned URL for file upload
router.post('/presigned-url', requireAuth, async (req, res) => {
  try {
    const uploadData = uploadMetadataSchema.parse(req.body);
    const userId = req.user!.id;

    // Validate file type and size limits
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedMimeTypes.includes(uploadData.mimeType)) {
      return res.status(400).json({
        success: false,
        message: 'File type not allowed'
      });
    }

    // Size limits based on purpose
    const sizeLimits = {
      profile: 5 * 1024 * 1024, // 5MB
      product: 10 * 1024 * 1024, // 10MB
      document: 20 * 1024 * 1024, // 20MB
      verification: 20 * 1024 * 1024, // 20MB
      other: 5 * 1024 * 1024 // 5MB
    };

    if (uploadData.fileSize > sizeLimits[uploadData.purpose]) {
      return res.status(400).json({
        success: false,
        message: `File size exceeds limit for ${uploadData.purpose} uploads`
      });
    }

    // Generate unique file key
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = uploadData.fileName.split('.').pop();
    const fileKey = `${uploadData.purpose}/${userId}/${timestamp}_${randomString}.${fileExtension}`;

    // In a real implementation, you would generate a presigned URL here
    // For now, we'll simulate the response
    const uploadUrl = `https://your-storage-bucket.com/upload/${fileKey}`;
    const fileUrl = `https://your-storage-bucket.com/${fileKey}`;

    // Log upload initiation
    await logUploadActivity(userId, 'FILE_UPLOAD_INITIATED', {
      fileName: uploadData.fileName,
      fileSize: uploadData.fileSize,
      mimeType: uploadData.mimeType,
      purpose: uploadData.purpose,
      fileKey
    });

    res.json({
      success: true,
      uploadUrl,
      fileUrl,
      fileKey,
      expiresIn: 3600, // 1 hour
      instructions: {
        method: 'PUT',
        headers: {
          'Content-Type': uploadData.mimeType,
          'Content-Length': uploadData.fileSize.toString()
        }
      }
    });
  } catch (error) {
    console.error('Generate presigned URL error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL'
    });
  }
});

// POST /api/upload/confirm - Confirm successful upload
router.post('/confirm', requireAuth, async (req, res) => {
  try {
    const { fileKey, fileUrl } = z.object({
      fileKey: z.string().min(1),
      fileUrl: z.string().url()
    }).parse(req.body);

    const userId = req.user!.id;

    // Log upload completion
    await logUploadActivity(userId, 'FILE_UPLOAD_COMPLETED', {
      fileKey,
      fileUrl
    });

    res.json({
      success: true,
      message: 'Upload confirmed successfully',
      fileUrl
    });
  } catch (error) {
    console.error('Confirm upload error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to confirm upload'
    });
  }
});

// DELETE /api/upload/:fileKey - Delete uploaded file
router.delete('/:fileKey', requireAuth, async (req, res) => {
  try {
    const fileKey = req.params.fileKey;
    const userId = req.user!.id;

    // Verify user owns the file (check if fileKey contains userId)
    if (!fileKey.includes(`/${userId}/`)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this file'
      });
    }

    // In a real implementation, you would delete from storage here

    // Log file deletion
    await logUploadActivity(userId, 'FILE_DELETED', {
      fileKey
    });

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file'
    });
  }
});

export default router;
