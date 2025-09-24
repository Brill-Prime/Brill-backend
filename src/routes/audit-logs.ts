import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { auditLogs, users } from '../db/schema';
import { eq, and, desc, gte, lte, ilike, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const auditLogsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  userId: z.string().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  ipAddress: z.string().optional()
});

const createAuditLogSchema = z.object({
  userId: z.number().int().positive().optional(),
  action: z.string().min(1, 'Action is required'),
  entityType: z.string().min(1, 'Entity type is required'),
  entityId: z.number().int().positive().optional(),
  details: z.record(z.string(), z.any()).optional().default({}),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().optional()
});

// GET /api/audit-logs - List audit logs (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const queryParams = auditLogsQuerySchema.parse(req.query);
    
    const pageNum = parseInt(queryParams.page);
    const limitNum = parseInt(queryParams.limit);
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [];

    if (queryParams.userId) {
      conditions.push(eq(auditLogs.userId, parseInt(queryParams.userId)));
    }

    if (queryParams.action) {
      conditions.push(ilike(auditLogs.action, `%${queryParams.action}%`));
    }

    if (queryParams.entityType) {
      conditions.push(eq(auditLogs.entityType, queryParams.entityType));
    }

    if (queryParams.entityId) {
      conditions.push(eq(auditLogs.entityId, parseInt(queryParams.entityId)));
    }

    if (queryParams.ipAddress) {
      conditions.push(eq(auditLogs.ipAddress, queryParams.ipAddress));
    }

    if (queryParams.startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(queryParams.startDate)));
    }

    if (queryParams.endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(queryParams.endDate)));
    }

    if (queryParams.search) {
      conditions.push(
        or(
          ilike(auditLogs.action, `%${queryParams.search}%`),
          ilike(auditLogs.entityType, `%${queryParams.search}%`),
          ilike(auditLogs.ipAddress, `%${queryParams.search}%`)
        )
      );
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get audit logs with user information
    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(auditLogs)
      .where(whereCondition);

    res.json({
      success: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit logs'
    });
  }
});

// GET /api/audit-logs/:id - Get specific audit log (Admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const logId = parseInt(req.params.id);

    if (isNaN(logId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid audit log ID'
      });
    }

    const [log] = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(eq(auditLogs.id, logId))
      .limit(1);

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Audit log not found'
      });
    }

    res.json({
      success: true,
      log
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit log'
    });
  }
});

// POST /api/audit-logs - Create audit log (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const logData = createAuditLogSchema.parse(req.body);
    const user = req.user!;

    const [newLog] = await db
      .insert(auditLogs)
      .values({
        userId: logData.userId || user.id,
        action: logData.action,
        entityType: logData.entityType,
        entityId: logData.entityId,
        details: logData.details,
        ipAddress: logData.ipAddress || req.ip,
        userAgent: logData.userAgent || req.headers['user-agent']
      })
      .returning();

    res.status(201).json({
      success: true,
      message: 'Audit log created successfully',
      log: newLog
    });
  } catch (error) {
    console.error('Create audit log error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create audit log'
    });
  }
});

// GET /api/audit-logs/user/:userId - Get audit logs for specific user (Admin only)
router.get('/user/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { page = '1', limit = '20', action, entityType, startDate, endDate } = req.query;

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
    const conditions = [eq(auditLogs.userId, userId)];

    if (action) {
      conditions.push(ilike(auditLogs.action, `%${action}%`));
    }

    if (entityType) {
      conditions.push(eq(auditLogs.entityType, entityType as string));
    }

    if (startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(startDate as string)));
    }

    if (endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(endDate as string)));
    }

    const whereCondition = and(...conditions);

    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt
      })
      .from(auditLogs)
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(auditLogs)
      .where(whereCondition);

    res.json({
      success: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('Get user audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user audit logs'
    });
  }
});

// GET /api/audit-logs/entity/:entityType/:entityId - Get audit logs for specific entity (Admin only)
router.get('/entity/:entityType/:entityId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { page = '1', limit = '20', action, startDate, endDate } = req.query;

    const entityIdNum = parseInt(entityId);
    if (isNaN(entityIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid entity ID'
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [
      eq(auditLogs.entityType, entityType),
      eq(auditLogs.entityId, entityIdNum)
    ];

    if (action) {
      conditions.push(ilike(auditLogs.action, `%${action}%`));
    }

    if (startDate) {
      conditions.push(gte(auditLogs.createdAt, new Date(startDate as string)));
    }

    if (endDate) {
      conditions.push(lte(auditLogs.createdAt, new Date(endDate as string)));
    }

    const whereCondition = and(...conditions);

    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(auditLogs)
      .where(whereCondition);

    res.json({
      success: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('Get entity audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve entity audit logs'
    });
  }
});

export default router;

const userAuditLogsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  action: z.string().optional(),
  entityType: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
});

// GET /api/audit-logs - List all audit logs (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const queryParams = auditLogsQuerySchema.parse(req.query);
    
    const pageNum = parseInt(queryParams.page);
    const limitNum = Math.min(parseInt(queryParams.limit), 100); // Max 100 items per page
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [];

    if (queryParams.userId) {
      const userId = parseInt(queryParams.userId);
      if (!isNaN(userId)) {
        conditions.push(eq(auditLogs.userId, userId));
      }
    }

    if (queryParams.action) {
      conditions.push(eq(auditLogs.action, queryParams.action));
    }

    if (queryParams.entityType) {
      conditions.push(eq(auditLogs.entityType, queryParams.entityType));
    }

    if (queryParams.entityId) {
      const entityId = parseInt(queryParams.entityId);
      if (!isNaN(entityId)) {
        conditions.push(eq(auditLogs.entityId, entityId));
      }
    }

    if (queryParams.ipAddress) {
      conditions.push(eq(auditLogs.ipAddress, queryParams.ipAddress));
    }

    // Date range filtering
    if (queryParams.startDate) {
      try {
        const startDate = new Date(queryParams.startDate);
        conditions.push(gte(auditLogs.createdAt, startDate));
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid start date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)'
        });
      }
    }

    if (queryParams.endDate) {
      try {
        const endDate = new Date(queryParams.endDate);
        conditions.push(lte(auditLogs.createdAt, endDate));
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid end date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)'
        });
      }
    }

    // Search across action, entity type, and details
    if (queryParams.search) {
      conditions.push(
        or(
          ilike(auditLogs.action, `%${queryParams.search}%`),
          ilike(auditLogs.entityType, `%${queryParams.search}%`),
          sql`${auditLogs.details}::text ILIKE ${`%${queryParams.search}%`}`
        )
      );
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get audit logs with user information
    const logs = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(auditLogs)
      .where(whereCondition);

    // Get summary statistics for the current filter
    const [summaryStats] = await db
      .select({
        totalActions: sql`count(*)`,
        uniqueUsers: sql`count(DISTINCT ${auditLogs.userId})`,
        uniqueActions: sql`count(DISTINCT ${auditLogs.action})`,
        uniqueEntityTypes: sql`count(DISTINCT ${auditLogs.entityType})`
      })
      .from(auditLogs)
      .where(whereCondition);

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
        totalActions: parseInt(summaryStats.totalActions as string),
        uniqueUsers: parseInt(summaryStats.uniqueUsers as string),
        uniqueActions: parseInt(summaryStats.uniqueActions as string),
        uniqueEntityTypes: parseInt(summaryStats.uniqueEntityTypes as string)
      }
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit logs'
    });
  }
});

// GET /api/audit-logs/user/:id - List audit logs by user
router.get('/user/:id', requireAuth, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const currentUser = req.user!;
    const queryParams = userAuditLogsQuerySchema.parse(req.query);

    if (isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Non-admin users can only view their own audit logs
    if (currentUser.role !== 'ADMIN' && currentUser.id !== targetUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own audit logs.'
      });
    }

    const pageNum = parseInt(queryParams.page);
    const limitNum = Math.min(parseInt(queryParams.limit), 100); // Max 100 items per page
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [eq(auditLogs.userId, targetUserId)];

    if (queryParams.action) {
      conditions.push(eq(auditLogs.action, queryParams.action));
    }

    if (queryParams.entityType) {
      conditions.push(eq(auditLogs.entityType, queryParams.entityType));
    }

    // Date range filtering
    if (queryParams.startDate) {
      try {
        const startDate = new Date(queryParams.startDate);
        conditions.push(gte(auditLogs.createdAt, startDate));
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid start date format'
        });
      }
    }

    if (queryParams.endDate) {
      try {
        const endDate = new Date(queryParams.endDate);
        conditions.push(lte(auditLogs.createdAt, endDate));
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid end date format'
        });
      }
    }

    // Search across action, entity type, and details
    if (queryParams.search) {
      conditions.push(
        or(
          ilike(auditLogs.action, `%${queryParams.search}%`),
          ilike(auditLogs.entityType, `%${queryParams.search}%`),
          sql`${auditLogs.details}::text ILIKE ${`%${queryParams.search}%`}`
        )
      );
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
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get audit logs for the user
    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt
      })
      .from(auditLogs)
      .where(whereCondition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(auditLogs)
      .where(whereCondition);

    // Get activity summary for this user
    const activitySummary = await db
      .select({
        action: auditLogs.action,
        count: sql`count(*)`,
        lastOccurrence: sql`max(${auditLogs.createdAt})`
      })
      .from(auditLogs)
      .where(eq(auditLogs.userId, targetUserId))
      .groupBy(auditLogs.action)
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
        action: item.action,
        count: parseInt(item.count as string),
        lastOccurrence: item.lastOccurrence
      }))
    });
  } catch (error) {
    console.error('List user audit logs error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user audit logs'
    });
  }
});

// GET /api/audit-logs/actions - Get list of available actions (Admin only)
router.get('/actions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const actions = await db
      .select({
        action: auditLogs.action,
        count: sql`count(*)`,
        lastOccurrence: sql`max(${auditLogs.createdAt})`
      })
      .from(auditLogs)
      .groupBy(auditLogs.action)
      .orderBy(desc(sql`count(*)`));

    res.json({
      success: true,
      actions: actions.map(item => ({
        action: item.action,
        count: parseInt(item.count as string),
        lastOccurrence: item.lastOccurrence
      }))
    });
  } catch (error) {
    console.error('List audit actions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit actions'
    });
  }
});

// GET /api/audit-logs/entity-types - Get list of available entity types (Admin only)
router.get('/entity-types', requireAuth, requireAdmin, async (req, res) => {
  try {
    const entityTypes = await db
      .select({
        entityType: auditLogs.entityType,
        count: sql`count(*)`,
        lastOccurrence: sql`max(${auditLogs.createdAt})`
      })
      .from(auditLogs)
      .groupBy(auditLogs.entityType)
      .orderBy(desc(sql`count(*)`));

    res.json({
      success: true,
      entityTypes: entityTypes.map(item => ({
        entityType: item.entityType,
        count: parseInt(item.count as string),
        lastOccurrence: item.lastOccurrence
      }))
    });
  } catch (error) {
    console.error('List audit entity types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit entity types'
    });
  }
});

export default router;