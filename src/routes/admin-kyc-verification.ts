import express from 'express';
import { db } from '../db/config';
import { identityVerifications, users, verificationDocuments } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// GET /api/admin/kyc-verification - List all KYC submissions
router.get('/api/admin/kyc-verification', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status as string;

    let whereConditions = [];
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'UNDER_REVIEW'].includes(status)) {
      whereConditions.push(eq(identityVerifications.verificationStatus, status as any));
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const verifications = await db
      .select({
        id: identityVerifications.id,
        userId: identityVerifications.userId,
        documentType: identityVerifications.documentType,
        verificationStatus: identityVerifications.verificationStatus,
        submittedAt: identityVerifications.submittedAt,
        reviewedAt: identityVerifications.reviewedAt,
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

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(identityVerifications)
      .where(whereClause);

    res.json({
      success: true,
      data: verifications,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Admin KYC verification error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch KYC verifications' });
  }
});

export default router;
