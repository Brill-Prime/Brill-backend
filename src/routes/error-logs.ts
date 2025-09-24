
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { errorLogs, users } from '../db/schema';
import { eq, and, desc, gte, lte, ilike, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const errorLogsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  userId: z.string().optional(),
  severity: z.string().optional(),
  source: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
});

// GET /api/error-logs - List all error logs (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = errorLogsQuerySchema.parse(req.query);
    const page = parseInt(query.page);
    const limit = parseInt(query.limit);
    const offset = (page - 1) * limit;

    // Build dynamic where conditions
    let whereConditions: any[] = [];

    if (query.userId) {
      whereConditions.push(eq(errorLogs.userId, parseInt(query.userId)));
    }

    if (query.severity) {
      whereConditions.push(eq(errorLogs.severity, query.severity));
    }

    if (query.source) {
      whereConditions.push(eq(errorLogs.source, query.source));
    }

    if (query.startDate) {
      whereConditions.push(gte(errorLogs.timestamp, new Date(query.startDate)));
    }

    if (query.endDate) {
      whereConditions.push(lte(errorLogs.timestamp, new Date(query.endDate)));
    }

    if (query.search) {
      whereConditions.push(
        or(
          ilike(errorLogs.message, `%${query.search}%`),
          ilike(errorLogs.url, `%${query.search}%`),
          ilike(errorLogs.stack, `%${query.search}%`)
        )
      );
    }

    // Get error logs with user information
    const logsQuery = db
      .select({
        id: errorLogs.id,
        message: errorLogs.message,
        stack: errorLogs.stack,
        url: errorLogs.url,
        userAgent: errorLogs.userAgent,
        userId: errorLogs.userId,
        severity: errorLogs.severity,
        source: errorLogs.source,
        timestamp: errorLogs.timestamp,
        metadata: errorLogs.metadata,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(errorLogs)
      .leftJoin(users, eq(errorLogs.userId, users.id))
      .orderBy(desc(errorLogs.timestamp))
      .limit(limit)
      .offset(offset);

    if (whereConditions.length > 0) {
      logsQuery.where(and(...whereConditions));
    }

    const logs = await logsQuery;

    // Get total count for pagination
    const countQuery = db
      .select({ count: sql`count(*)` })
      .from(errorLogs);

    if (whereConditions.length > 0) {
      countQuery.where(and(...whereConditions));
    }

    const [{ count }] = await countQuery;
    const totalCount = parseInt(count as string);
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error('List error logs error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve error logs'
    });
  }
});

// GET /api/error-logs/stats - Get error log statistics (Admin only)
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get severity distribution
    const severityStats = await db
      .select({
        severity: errorLogs.severity,
        count: sql`count(*)`,
        latestOccurrence: sql`max(${errorLogs.timestamp})`
      })
      .from(errorLogs)
      .groupBy(errorLogs.severity)
      .orderBy(desc(sql`count(*)`));

    // Get source distribution
    const sourceStats = await db
      .select({
        source: errorLogs.source,
        count: sql`count(*)`,
        latestOccurrence: sql`max(${errorLogs.timestamp})`
      })
      .from(errorLogs)
      .groupBy(errorLogs.source)
      .orderBy(desc(sql`count(*)`));

    // Get recent error count (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recentErrors] = await db
      .select({ count: sql`count(*)` })
      .from(errorLogs)
      .where(gte(errorLogs.timestamp, twentyFourHoursAgo));

    // Get total error count
    const [totalErrors] = await db
      .select({ count: sql`count(*)` })
      .from(errorLogs);

    res.json({
      success: true,
      stats: {
        totalErrors: parseInt(totalErrors.count as string),
        recentErrors: parseInt(recentErrors.count as string),
        severityDistribution: severityStats.map(item => ({
          severity: item.severity,
          count: parseInt(item.count as string),
          latestOccurrence: item.latestOccurrence
        })),
        sourceDistribution: sourceStats.map(item => ({
          source: item.source,
          count: parseInt(item.count as string),
          latestOccurrence: item.latestOccurrence
        }))
      }
    });
  } catch (error) {
    console.error('Error log stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve error log statistics'
    });
  }
});

// GET /api/error-logs/:id - Get specific error log by ID (Admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid error log ID'
      });
    }

    const [errorLog] = await db
      .select({
        id: errorLogs.id,
        message: errorLogs.message,
        stack: errorLogs.stack,
        url: errorLogs.url,
        userAgent: errorLogs.userAgent,
        userId: errorLogs.userId,
        severity: errorLogs.severity,
        source: errorLogs.source,
        timestamp: errorLogs.timestamp,
        metadata: errorLogs.metadata,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(errorLogs)
      .leftJoin(users, eq(errorLogs.userId, users.id))
      .where(eq(errorLogs.id, id))
      .limit(1);

    if (!errorLog) {
      return res.status(404).json({
        success: false,
        message: 'Error log not found'
      });
    }

    res.json({
      success: true,
      data: errorLog
    });
  } catch (error) {
    console.error('Get error log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve error log'
    });
  }
});

export default router;
