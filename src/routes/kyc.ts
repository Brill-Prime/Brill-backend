
import express from 'express';
import { db } from '../db/config';
import { identityVerifications, verificationDocuments, users } from '../db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

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
