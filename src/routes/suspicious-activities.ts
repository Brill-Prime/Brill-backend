
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { suspiciousActivities, users } from '../db/schema';
import { eq, and, desc, gte, lte, ilike, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const suspiciousActivityQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  userId: z.string().optional(),
  activityType: z.string().optional(),
  riskLevel: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
});

const createSuspiciousActivitySchema = z.object({
  userId: z.number().optional(),
  activityType: z.string().min(1),
  description: z.string().min(1),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  riskIndicators: z.record(z.any()).default({}),
  ipAddress: z.string().optional(),
  deviceFingerprint: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM')
});

// POST /api/suspicious-activities - Report a suspicious activity
router.post('/', requireAuth, async (req, res) => {
  try {
    const activityData = createSuspiciousActivitySchema.parse(req.body);

    const [newActivity] = await db
      .insert(suspiciousActivities)
      .values({
        ...activityData,
        timestamp: new Date()
      })
      .returning();

    res.status(201).json({
      success: true,
      message: 'Suspicious activity reported successfully',
      data: newActivity
    });
  } catch (error) {
    console.error('Create suspicious activity error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to report suspicious activity'
    });
  }
});

// GET /api/suspicious-activities - List all suspicious activities (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = suspiciousActivityQuerySchema.parse(req.query);
    const page = parseInt(query.page);
    const limit = Math.min(parseInt(query.limit), 100);
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];

    if (query.userId) {
      conditions.push(eq(suspiciousActivities.userId, parseInt(query.userId)));
    }

    if (query.activityType) {
      conditions.push(ilike(suspiciousActivities.activityType, `%${query.activityType}%`));
    }

    if (query.riskLevel) {
      conditions.push(eq(suspiciousActivities.riskLevel, query.riskLevel));
    }

    if (query.status) {
      conditions.push(eq(suspiciousActivities.status, query.status));
    }

    if (query.startDate) {
      conditions.push(gte(suspiciousActivities.timestamp, new Date(query.startDate)));
    }

    if (query.endDate) {
      conditions.push(lte(suspiciousActivities.timestamp, new Date(query.endDate)));
    }

    if (query.search) {
      conditions.push(
        or(
          ilike(suspiciousActivities.description, `%${query.search}%`),
          ilike(suspiciousActivities.activityType, `%${query.search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get suspicious activities with user details
    const activities = await db
      .select({
        id: suspiciousActivities.id,
        userId: suspiciousActivities.userId,
        activityType: suspiciousActivities.activityType,
        description: suspiciousActivities.description,
        riskLevel: suspiciousActivities.riskLevel,
        riskIndicators: suspiciousActivities.riskIndicators,
        timestamp: suspiciousActivities.timestamp,
        ipAddress: suspiciousActivities.ipAddress,
        deviceFingerprint: suspiciousActivities.deviceFingerprint,
        severity: suspiciousActivities.severity,
        status: suspiciousActivities.status,
        investigatedBy: suspiciousActivities.investigatedBy,
        investigatedAt: suspiciousActivities.investigatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role
        }
      })
      .from(suspiciousActivities)
      .leftJoin(users, eq(suspiciousActivities.userId, users.id))
      .where(whereClause)
      .orderBy(desc(suspiciousActivities.timestamp))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(suspiciousActivities)
      .where(whereClause);

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: activities,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Get suspicious activities error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suspicious activities'
    });
  }
});

export default router;
