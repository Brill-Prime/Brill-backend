import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { contentReports, users, products, orders } from '../db/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

const moderationActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'DELETE', 'WARN']),
  reason: z.string().optional(),
  notes: z.string().optional()
});

// GET /api/admin/moderation - Get pending moderation items
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const pendingReports = await db
      .select({
        id: contentReports.id,
        reportType: contentReports.reportType,
        reason: contentReports.reason,
        description: contentReports.description,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
        reporter: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        }
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reporterId, users.id))
      .where(eq(contentReports.status, 'PENDING'))
      .orderBy(desc(contentReports.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contentReports)
      .where(eq(contentReports.status, 'PENDING'));

    res.json({
      success: true,
      data: pendingReports,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Moderation list error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch moderation items' });
  }
});

// POST /api/admin/moderation/:reportId/action - Take moderation action
router.post('/:reportId/action', requireAuth, requireAdmin, async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    const validatedData = moderationActionSchema.parse(req.body);

    const [report] = await db
      .select()
      .from(contentReports)
      .where(eq(contentReports.id, reportId))
      .limit(1);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    await db
      .update(contentReports)
      .set({
        status: validatedData.action === 'APPROVE' ? 'RESOLVED' : 'REJECTED',
        reviewedAt: new Date(),
        reviewedBy: req.user!.id
      })
      .where(eq(contentReports.id, reportId));

    res.json({
      success: true,
      message: `Moderation action ${validatedData.action} completed`
    });
  } catch (error) {
    console.error('Moderation action error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    res.status(500).json({ success: false, message: 'Failed to process moderation action' });
  }
});

export default router;
