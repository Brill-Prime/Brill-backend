import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { contentReports, users, auditLogs } from '../db/schema';
import { eq, and, desc, ilike, or, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createContentReportSchema = z.object({
  contentType: z.string().min(1, 'Content type is required'),
  contentId: z.number().int().positive('Content ID must be a positive integer'),
  reason: z.string().min(1, 'Reason is required'),
  description: z.string().optional()
});

const updateContentReportSchema = z.object({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']).optional(),
  resolvedAt: z.string().optional().transform(val => val ? new Date(val) : undefined)
});

// Helper function to log audit activity
async function logAuditActivity(userId: number, action: string, entityType: string, entityId: number, details: any) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to log audit activity:', error);
  }
}

// POST /api/content-reports - Report content
router.post('/', requireAuth, async (req, res) => {
  try {
    const reportData = createContentReportSchema.parse(req.body);
    const user = req.user!;

    // Check if the user has already reported this content
    const existingReport = await db
      .select()
      .from(contentReports)
      .where(and(
        eq(contentReports.reportedBy, user.id),
        eq(contentReports.contentType, reportData.contentType),
        eq(contentReports.contentId, reportData.contentId),
        isNull(contentReports.deletedAt)
      ))
      .limit(1);

    if (existingReport.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already reported this content'
      });
    }

    const [newReport] = await db
      .insert(contentReports)
      .values({
        reportedBy: user.id,
        contentType: reportData.contentType,
        contentId: reportData.contentId,
        reason: reportData.reason,
        description: reportData.description,
        status: 'PENDING'
      })
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'CONTENT_REPORTED',
      'CONTENT_REPORT',
      newReport.id,
      {
        contentType: reportData.contentType,
        contentId: reportData.contentId,
        reason: reportData.reason
      }
    );

    res.status(201).json({
      success: true,
      message: 'Content report submitted successfully',
      data: {
        id: newReport.id,
        contentType: newReport.contentType,
        contentId: newReport.contentId,
        reason: newReport.reason,
        description: newReport.description,
        status: newReport.status,
        createdAt: newReport.createdAt
      }
    });
  } catch (error) {
    console.error('Create content report error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create content report'
    });
  }
});

// GET /api/content-reports - List all content reports
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const contentType = req.query.contentType as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(contentReports.deletedAt)];

    // Non-admin users can only see their own reports
    if (user.role !== 'ADMIN') {
      conditions.push(eq(contentReports.reportedBy, user.id));
    }

    // Add filters
    if (status) {
      conditions.push(eq(contentReports.status, status));
    }

    if (contentType) {
      conditions.push(eq(contentReports.contentType, contentType));
    }

    if (search) {
      conditions.push(
        or(
          ilike(contentReports.reason, `%${search}%`),
          ilike(contentReports.description, `%${search}%`)
        )!
      );
    }

    const reports = await db
      .select({
        id: contentReports.id,
        contentType: contentReports.contentType,
        contentId: contentReports.contentId,
        reason: contentReports.reason,
        description: contentReports.description,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
        resolvedAt: contentReports.resolvedAt,
        reportedBy: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        }
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reportedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(contentReports.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalResult = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(contentReports)
      .where(and(...conditions));

    const total = totalResult[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: reports,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get content reports error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve content reports'
    });
  }
});

// GET /api/content-reports/:id - Get a specific content report
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const reportId = parseInt(req.params.id);

    if (isNaN(reportId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report ID'
      });
    }

    const conditions = [
      eq(contentReports.id, reportId),
      isNull(contentReports.deletedAt)
    ];

    // Non-admin users can only see their own reports
    if (user.role !== 'ADMIN') {
      conditions.push(eq(contentReports.reportedBy, user.id));
    }

    const [report] = await db
      .select({
        id: contentReports.id,
        contentType: contentReports.contentType,
        contentId: contentReports.contentId,
        reason: contentReports.reason,
        description: contentReports.description,
        status: contentReports.status,
        createdAt: contentReports.createdAt,
        resolvedAt: contentReports.resolvedAt,
        reportedBy: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        }
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reportedBy, users.id))
      .where(and(...conditions))
      .limit(1);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Content report not found'
      });
    }

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Get content report error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve content report'
    });
  }
});

// PUT /api/content-reports/:id - Update content report status (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const reportId = parseInt(req.params.id);
    const updateData = updateContentReportSchema.parse(req.body);
    const user = req.user!;

    if (isNaN(reportId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report ID'
      });
    }

    // Check if report exists
    const existingReport = await db
      .select()
      .from(contentReports)
      .where(and(
        eq(contentReports.id, reportId),
        isNull(contentReports.deletedAt)
      ))
      .limit(1);

    if (!existingReport.length) {
      return res.status(404).json({
        success: false,
        message: 'Content report not found'
      });
    }

    const [updatedReport] = await db
      .update(contentReports)
      .set({
        ...updateData,
        ...(updateData.status === 'RESOLVED' && !updateData.resolvedAt ? { resolvedAt: new Date() } : {})
      })
      .where(eq(contentReports.id, reportId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'CONTENT_REPORT_UPDATED',
      'CONTENT_REPORT',
      reportId,
      {
        previousStatus: existingReport[0].status,
        newStatus: updateData.status,
        changes: updateData
      }
    );

    res.json({
      success: true,
      message: 'Content report updated successfully',
      data: updatedReport
    });
  } catch (error) {
    console.error('Update content report error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update content report'
    });
  }
});

export default router;