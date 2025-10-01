
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { securityLogs, users, auditLogs } from '../db/schema';
import { eq, and, desc, gte, lte, ilike, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const securityLogsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  userId: z.string().optional(),
  eventType: z.string().optional(),
  action: z.string().optional(),
  severity: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  ipAddress: z.string().optional()
});

// Helper function to log audit actions
async function logAuditAction(userId: number, action: string, details: any = {}) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'SECURITY_LOG',
      details: typeof details === 'object' ? details : { message: details }
    });
  } catch (error) {
    console.error('Failed to log audit action:', error);
  }
}

// GET /api/security-logs - List all security logs (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const queryParams = securityLogsQuerySchema.parse(req.query);
    
    const pageNum = parseInt(queryParams.page);
    const limitNum = Math.min(parseInt(queryParams.limit), 100); // Max 100 items per page
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [];

    if (queryParams.userId) {
      const userId = parseInt(queryParams.userId);
      if (!isNaN(userId)) {
        conditions.push(eq(securityLogs.userId, userId));
      }
    }

    if (queryParams.eventType) {
      conditions.push(eq(securityLogs.eventType, queryParams.eventType));
    }

    if (queryParams.action) {
      conditions.push(eq(securityLogs.action, queryParams.action));
    }

    if (queryParams.severity) {
      conditions.push(eq(securityLogs.severity, queryParams.severity));
    }

    if (queryParams.ipAddress) {
      conditions.push(eq(securityLogs.ipAddress, queryParams.ipAddress));
    }

    if (queryParams.startDate) {
      conditions.push(gte(securityLogs.timestamp, new Date(queryParams.startDate)));
    }

    if (queryParams.endDate) {
      conditions.push(lte(securityLogs.timestamp, new Date(queryParams.endDate)));
    }

    if (queryParams.search) {
      conditions.push(
        or(
          ilike(securityLogs.eventType, `%${queryParams.search}%`),
          ilike(securityLogs.action, `%${queryParams.search}%`),
          ilike(securityLogs.ipAddress, `%${queryParams.search}%`),
          sql`${securityLogs.details}::text ILIKE ${`%${queryParams.search}%`}`
        )
      );
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get security logs with user information
    const logs = await db
      .select({
        id: securityLogs.id,
        eventType: securityLogs.eventType,
        action: securityLogs.action,
        details: securityLogs.details,
        ipAddress: securityLogs.ipAddress,
        userAgent: securityLogs.userAgent,
        severity: securityLogs.severity,
        timestamp: securityLogs.timestamp,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(securityLogs)
      .leftJoin(users, eq(securityLogs.userId, users.id))
      .where(whereCondition)
      .orderBy(desc(securityLogs.timestamp))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(securityLogs)
      .where(whereCondition);

    // Get summary statistics for the current filter
    const [summaryStats] = await db
      .select({
        totalLogs: sql`count(*)`,
        uniqueUsers: sql`count(DISTINCT ${securityLogs.userId})`,
        uniqueEventTypes: sql`count(DISTINCT ${securityLogs.eventType})`,
        uniqueActions: sql`count(DISTINCT ${securityLogs.action})`
      })
      .from(securityLogs)
      .where(whereCondition);

    // Log this admin action
    const user = req.user;
    if (user) {
      await logAuditAction(
        typeof user.id === 'string' ? parseInt(user.id) : user.id,
        'SECURITY_LOGS_VIEWED',
        { filters: queryParams }
      );
    }

    res.json({
      success: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      },
      summary: {
        totalLogs: parseInt(summaryStats.totalLogs as string),
        uniqueUsers: parseInt(summaryStats.uniqueUsers as string),
        uniqueEventTypes: parseInt(summaryStats.uniqueEventTypes as string),
        uniqueActions: parseInt(summaryStats.uniqueActions as string)
      }
    });
  } catch (error) {
    console.error('List security logs error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve security logs'
    });
  }
});

// GET /api/security-logs/:id - Get specific security log (Admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const logId = parseInt(req.params.id);

    if (isNaN(logId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid security log ID'
      });
    }

    const [log] = await db
      .select({
        id: securityLogs.id,
        eventType: securityLogs.eventType,
        action: securityLogs.action,
        details: securityLogs.details,
        ipAddress: securityLogs.ipAddress,
        userAgent: securityLogs.userAgent,
        severity: securityLogs.severity,
        timestamp: securityLogs.timestamp,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(securityLogs)
      .leftJoin(users, eq(securityLogs.userId, users.id))
      .where(eq(securityLogs.id, logId))
      .limit(1);

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Security log not found'
      });
    }

    res.json({
      success: true,
      log
    });
  } catch (error) {
    console.error('Get security log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve security log'
    });
  }
});

// GET /api/security-logs/user/:userId - Get security logs for specific user (Admin only)
router.get('/user/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { page = '1', limit = '20', eventType, action, severity, startDate, endDate } = req.query;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [eq(securityLogs.userId, userId)];

    if (eventType) {
      conditions.push(eq(securityLogs.eventType, eventType as string));
    }

    if (action) {
      conditions.push(eq(securityLogs.action, action as string));
    }

    if (severity) {
      conditions.push(eq(securityLogs.severity, severity as string));
    }

    if (startDate) {
      conditions.push(gte(securityLogs.timestamp, new Date(startDate as string)));
    }

    if (endDate) {
      conditions.push(lte(securityLogs.timestamp, new Date(endDate as string)));
    }

    const whereCondition = and(...conditions);

    // Get user information first
    const [targetUser] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get security logs for the user
    const logs = await db
      .select({
        id: securityLogs.id,
        eventType: securityLogs.eventType,
        action: securityLogs.action,
        details: securityLogs.details,
        ipAddress: securityLogs.ipAddress,
        userAgent: securityLogs.userAgent,
        severity: securityLogs.severity,
        timestamp: securityLogs.timestamp
      })
      .from(securityLogs)
      .where(whereCondition)
      .orderBy(desc(securityLogs.timestamp))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(securityLogs)
      .where(whereCondition);

    // Get activity summary for this user
    const activitySummary = await db
      .select({
        eventType: securityLogs.eventType,
        count: sql`count(*)`,
        lastOccurrence: sql`max(${securityLogs.timestamp})`
      })
      .from(securityLogs)
      .where(eq(securityLogs.userId, userId))
      .groupBy(securityLogs.eventType)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    res.json({
      success: true,
      user: targetUser,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      },
      activitySummary: activitySummary.map(item => ({
        eventType: item.eventType,
        count: parseInt(item.count as string),
        lastOccurrence: item.lastOccurrence
      }))
    });
  } catch (error) {
    console.error('List user security logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user security logs'
    });
  }
});

// GET /api/security-logs/event-types - Get list of available event types (Admin only)
router.get('/event-types', requireAuth, requireAdmin, async (req, res) => {
  try {
    const eventTypes = await db
      .select({
        eventType: securityLogs.eventType,
        count: sql`count(*)`,
        lastOccurrence: sql`max(${securityLogs.timestamp})`
      })
      .from(securityLogs)
      .groupBy(securityLogs.eventType)
      .orderBy(desc(sql`count(*)`));

    res.json({
      success: true,
      eventTypes: eventTypes.map(item => ({
        eventType: item.eventType,
        count: parseInt(item.count as string),
        lastOccurrence: item.lastOccurrence
      }))
    });
  } catch (error) {
    console.error('List security event types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve security event types'
    });
  }
});

export default router;
