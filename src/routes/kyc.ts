
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
      .orderBy(desc(identityVerifications.submittedAt))
      .limit(1);

    const documents = await db
      .select()
      .from(verificationDocuments)
      .where(and(
        eq(verificationDocuments.userId, userId),
        isNull(verificationDocuments.deletedAt)
      ))
      .orderBy(desc(verificationDocuments.uploadedAt));

    res.json({
      success: true,
      data: {
        userId,
        verificationStatus: verifications[0]?.verificationStatus || 'PENDING',
        documents: documents.map(doc => ({
          id: doc.id,
          documentType: doc.documentType,
          status: doc.status,
          uploadedAt: doc.uploadedAt
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
    const { documentType, documentNumber, fileName, fileSize, mimeType } = req.body;

    const [newDocument] = await db
      .insert(verificationDocuments)
      .values({
        userId,
        documentType,
        documentNumber,
        fileName,
        fileSize,
        mimeType,
        status: 'PENDING'
      })
      .returning();

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: newDocument
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
});

// POST /api/kyc/submit - Submit KYC for verification
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { documentType, documentNumber } = req.body;

    const [verification] = await db
      .insert(identityVerifications)
      .values({
        userId,
        documentType,
        documentNumber,
        verificationStatus: 'PENDING',
        submittedAt: new Date()
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
      .orderBy(desc(identityVerifications.submittedAt))
      .limit(1);

    res.json({
      success: true,
      data: {
        status: verification?.verificationStatus || 'PENDING',
        submittedAt: verification?.submittedAt || null,
        reviewedAt: verification?.reviewedAt || null
      }
    });
  } catch (error) {
    console.error('Get KYC status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get KYC status' });
  }
});

export default router;
