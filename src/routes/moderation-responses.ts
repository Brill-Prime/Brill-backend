import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { moderationResponses, contentReports, adminUsers, users, auditLogs } from '../db/schema';
import { eq, and, desc, ilike, or, isNull, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createModerationResponseSchema = z.object({
  reportId: z.number().int().positive('Report ID must be a positive integer'),
  response: z.string().min(1, 'Response is required'),
  action: z.string().min(1, 'Action is required')
});

const updateModerationResponseSchema = z.object({
  response: z.string().min(1).optional(),
  action: z.string().min(1).optional()
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

// POST /api/moderation-responses - Respond to a content report
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const responseData = createModerationResponseSchema.parse(req.body);
    const user = req.user!;

    // Check if the content report exists
    const existingReport = await db
      .select()
      .from(contentReports)
      .where(and(
        eq(contentReports.id, responseData.reportId),
        isNull(contentReports.deletedAt)
      ))
      .limit(1);

    if (!existingReport.length) {
      return res.status(404).json({
        success: false,
        message: 'Content report not found'
      });
    }

    // Get or create admin user record
    let adminUser = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.userId, user.id))
      .limit(1);

    if (!adminUser.length) {
      // Create admin user record if it doesn't exist
      const [newAdminUser] = await db
        .insert(adminUsers)
        .values({
          userId: user.id,
          permissions: '{}',
          department: 'Moderation'
        })
        .returning();
      adminUser = [newAdminUser];
    }

    const [newResponse] = await db
      .insert(moderationResponses)
      .values({
        reportId: responseData.reportId,
        adminId: adminUser[0].id,
        response: responseData.response,
        action: responseData.action
      })
      .returning();

    // Update the content report status to resolved
    await db
      .update(contentReports)
      .set({
        status: 'RESOLVED',
        resolvedAt: new Date()
      })
      .where(eq(contentReports.id, responseData.reportId));

    // Log audit activity
    await logAuditActivity(
      user.id,
      'MODERATION_RESPONSE_CREATED',
      'MODERATION_RESPONSE',
      newResponse.id,
      {
        reportId: responseData.reportId,
        action: responseData.action,
        response: responseData.response
      }
    );

    res.status(201).json({
      success: true,
      message: 'Moderation response submitted successfully',
      data: {
        id: newResponse.id,
        reportId: newResponse.reportId,
        response: newResponse.response,
        action: newResponse.action,
        createdAt: newResponse.createdAt
      }
    });
  } catch (error) {
    console.error('Create moderation response error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create moderation response'
    });
  }
});

// GET /api/moderation-responses - List all moderation responses
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const reportId = req.query.reportId as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(moderationResponses.deletedAt)];

    // Add filters
    if (reportId) {
      const reportIdNum = parseInt(reportId);
      if (!isNaN(reportIdNum)) {
        conditions.push(eq(moderationResponses.reportId, reportIdNum));
      }
    }

    if (search) {
      conditions.push(
        or(
          ilike(moderationResponses.response, `%${search}%`),
          ilike(moderationResponses.action, `%${search}%`)
        )!
      );
    }

    const responses = await db
      .select({
        id: moderationResponses.id,
        reportId: moderationResponses.reportId,
        response: moderationResponses.response,
        action: moderationResponses.action,
        createdAt: moderationResponses.createdAt,
        admin: {
          id: adminUsers.id,
          userId: adminUsers.userId,
          fullName: users.fullName,
          email: users.email
        },
        report: {
          id: contentReports.id,
          contentType: contentReports.contentType,
          contentId: contentReports.contentId,
          reason: contentReports.reason,
          status: contentReports.status
        }
      })
      .from(moderationResponses)
      .leftJoin(adminUsers, eq(moderationResponses.adminId, adminUsers.id))
      .leftJoin(users, eq(adminUsers.userId, users.id))
      .leftJoin(contentReports, eq(moderationResponses.reportId, contentReports.id))
      .where(and(...conditions))
      .orderBy(desc(moderationResponses.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalResult = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(moderationResponses)
      .where(and(...conditions));

    const total = totalResult[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: responses,
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
    console.error('Get moderation responses error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve moderation responses'
    });
  }
});

// GET /api/moderation-responses/:id - Get a specific moderation response
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const responseId = parseInt(req.params.id);

    if (isNaN(responseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid response ID'
      });
    }

    const [response] = await db
      .select({
        id: moderationResponses.id,
        reportId: moderationResponses.reportId,
        response: moderationResponses.response,
        action: moderationResponses.action,
        createdAt: moderationResponses.createdAt,
        admin: {
          id: adminUsers.id,
          userId: adminUsers.userId,
          fullName: users.fullName,
          email: users.email
        },
        report: {
          id: contentReports.id,
          contentType: contentReports.contentType,
          contentId: contentReports.contentId,
          reason: contentReports.reason,
          description: contentReports.description,
          status: contentReports.status,
          createdAt: contentReports.createdAt
        }
      })
      .from(moderationResponses)
      .leftJoin(adminUsers, eq(moderationResponses.adminId, adminUsers.id))
      .leftJoin(users, eq(adminUsers.userId, users.id))
      .leftJoin(contentReports, eq(moderationResponses.reportId, contentReports.id))
      .where(and(
        eq(moderationResponses.id, responseId),
        isNull(moderationResponses.deletedAt)
      ))
      .limit(1);

    if (!response) {
      return res.status(404).json({
        success: false,
        message: 'Moderation response not found'
      });
    }

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Get moderation response error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve moderation response'
    });
  }
});

// PUT /api/moderation-responses/:id - Update moderation response (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const responseId = parseInt(req.params.id);
    const updateData = updateModerationResponseSchema.parse(req.body);
    const user = req.user!;

    if (isNaN(responseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid response ID'
      });
    }

    // Check if response exists
    const existingResponse = await db
      .select()
      .from(moderationResponses)
      .where(and(
        eq(moderationResponses.id, responseId),
        isNull(moderationResponses.deletedAt)
      ))
      .limit(1);

    if (!existingResponse.length) {
      return res.status(404).json({
        success: false,
        message: 'Moderation response not found'
      });
    }

    const [updatedResponse] = await db
      .update(moderationResponses)
      .set(updateData)
      .where(eq(moderationResponses.id, responseId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'MODERATION_RESPONSE_UPDATED',
      'MODERATION_RESPONSE',
      responseId,
      {
        changes: updateData,
        previousResponse: existingResponse[0].response,
        previousAction: existingResponse[0].action
      }
    );

    res.json({
      success: true,
      message: 'Moderation response updated successfully',
      data: updatedResponse
    });
  } catch (error) {
    console.error('Update moderation response error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update moderation response'
    });
  }
});

export default router;