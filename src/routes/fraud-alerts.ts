import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { fraudAlerts, users, transactions, orders, auditLogs } from '../db/schema';
import { eq, and, desc, ilike, or, sql, gte, lte } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createFraudAlertSchema = z.object({
  userId: z.number().int().positive('User ID must be a positive integer').optional(),
  transactionId: z.number().int().positive('Transaction ID must be a positive integer').optional(),
  orderId: z.number().int().positive('Order ID must be a positive integer').optional(),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().default('MEDIUM'),
  metadata: z.record(z.string(), z.any()).optional().default({})
});

const updateFraudAlertSchema = z.object({
  status: z.enum(['PENDING', 'INVESTIGATED', 'RESOLVED', 'FALSE_POSITIVE']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

const fraudAlertsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  userId: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
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

// POST /api/fraud-alerts - Create fraud alert (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertData = createFraudAlertSchema.parse(req.body);
    const user = req.user!;

    // Validate that at least one of userId, transactionId, or orderId is provided
    if (!alertData.userId && !alertData.transactionId && !alertData.orderId) {
      return res.status(400).json({
        success: false,
        message: 'At least one of userId, transactionId, or orderId must be provided'
      });
    }

    // Verify referenced entities exist
    if (alertData.userId) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, alertData.userId))
        .limit(1);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Referenced user not found'
        });
      }
    }

    if (alertData.transactionId) {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, alertData.transactionId))
        .limit(1);

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: 'Referenced transaction not found'
        });
      }
    }

    if (alertData.orderId) {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, alertData.orderId))
        .limit(1);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Referenced order not found'
        });
      }
    }

    const [newAlert] = await db
      .insert(fraudAlerts)
      .values({
        userId: alertData.userId,
        transactionId: alertData.transactionId,
        orderId: alertData.orderId,
        reason: alertData.reason,
        severity: alertData.severity,
        status: 'PENDING',
        metadata: alertData.metadata
      })
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'FRAUD_ALERT_CREATED',
      'FRAUD_ALERT',
      newAlert.id,
      { reason: alertData.reason, severity: alertData.severity }
    );

    res.status(201).json({
      success: true,
      message: 'Fraud alert created successfully',
      alert: newAlert
    });
  } catch (error) {
    console.error('Create fraud alert error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create fraud alert'
    });
  }
});

// GET /api/fraud-alerts - List fraud alerts (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const queryParams = fraudAlertsQuerySchema.parse(req.query);
    
    const pageNum = parseInt(queryParams.page);
    const limitNum = parseInt(queryParams.limit);
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [];

    if (queryParams.userId) {
      conditions.push(eq(fraudAlerts.userId, parseInt(queryParams.userId)));
    }

    if (queryParams.severity) {
      conditions.push(eq(fraudAlerts.severity, queryParams.severity));
    }

    if (queryParams.status) {
      conditions.push(eq(fraudAlerts.status, queryParams.status));
    }

    if (queryParams.startDate) {
      conditions.push(gte(fraudAlerts.createdAt, new Date(queryParams.startDate)));
    }

    if (queryParams.endDate) {
      conditions.push(lte(fraudAlerts.createdAt, new Date(queryParams.endDate)));
    }

    if (queryParams.search) {
      conditions.push(ilike(fraudAlerts.reason, `%${queryParams.search}%`));
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get fraud alerts with related information
    const alerts = await db
      .select({
        id: fraudAlerts.id,
        reason: fraudAlerts.reason,
        severity: fraudAlerts.severity,
        status: fraudAlerts.status,
        metadata: fraudAlerts.metadata,
        createdAt: fraudAlerts.createdAt,
        updatedAt: fraudAlerts.updatedAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        },
        transaction: {
          id: transactions.id,
          transactionRef: transactions.transactionRef,
          amount: transactions.amount
        },
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          totalAmount: orders.totalAmount
        }
      })
      .from(fraudAlerts)
      .leftJoin(users, eq(fraudAlerts.userId, users.id))
      .leftJoin(transactions, eq(fraudAlerts.transactionId, transactions.id))
      .leftJoin(orders, eq(fraudAlerts.orderId, orders.id))
      .where(whereCondition)
      .orderBy(desc(fraudAlerts.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(fraudAlerts)
      .where(whereCondition);

    res.json({
      success: true,
      alerts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('List fraud alerts error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve fraud alerts'
    });
  }
});

// GET /api/fraud-alerts/:id - Get specific fraud alert (Admin only)
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);

    if (isNaN(alertId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fraud alert ID'
      });
    }

    const [alert] = await db
      .select({
        id: fraudAlerts.id,
        reason: fraudAlerts.reason,
        severity: fraudAlerts.severity,
        status: fraudAlerts.status,
        metadata: fraudAlerts.metadata,
        createdAt: fraudAlerts.createdAt,
        updatedAt: fraudAlerts.updatedAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          role: users.role
        },
        transaction: {
          id: transactions.id,
          transactionRef: transactions.transactionRef,
          amount: transactions.amount,
          type: transactions.type,
          status: transactions.status
        },
        order: {
          id: orders.id,
          orderNumber: orders.orderNumber,
          totalAmount: orders.totalAmount,
          status: orders.status
        }
      })
      .from(fraudAlerts)
      .leftJoin(users, eq(fraudAlerts.userId, users.id))
      .leftJoin(transactions, eq(fraudAlerts.transactionId, transactions.id))
      .leftJoin(orders, eq(fraudAlerts.orderId, orders.id))
      .where(eq(fraudAlerts.id, alertId))
      .limit(1);

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: 'Fraud alert not found'
      });
    }

    res.json({
      success: true,
      alert
    });
  } catch (error) {
    console.error('Get fraud alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve fraud alert'
    });
  }
});

// PUT /api/fraud-alerts/:id - Update fraud alert (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const user = req.user!;
    const updateData = updateFraudAlertSchema.parse(req.body);

    if (isNaN(alertId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fraud alert ID'
      });
    }

    const [existingAlert] = await db
      .select()
      .from(fraudAlerts)
      .where(eq(fraudAlerts.id, alertId))
      .limit(1);

    if (!existingAlert) {
      return res.status(404).json({
        success: false,
        message: 'Fraud alert not found'
      });
    }

    const [updatedAlert] = await db
      .update(fraudAlerts)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(fraudAlerts.id, alertId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'FRAUD_ALERT_UPDATED',
      'FRAUD_ALERT',
      alertId,
      { changes: updateData, previousStatus: existingAlert.status }
    );

    res.json({
      success: true,
      message: 'Fraud alert updated successfully',
      alert: updatedAlert
    });
  } catch (error) {
    console.error('Update fraud alert error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update fraud alert'
    });
  }
});

// POST /api/fraud-alerts/:id/investigate - Mark fraud alert as investigated (Admin only)
router.post('/:id/investigate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(alertId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fraud alert ID'
      });
    }

    const [existingAlert] = await db
      .select()
      .from(fraudAlerts)
      .where(eq(fraudAlerts.id, alertId))
      .limit(1);

    if (!existingAlert) {
      return res.status(404).json({
        success: false,
        message: 'Fraud alert not found'
      });
    }

    if (existingAlert.status === 'INVESTIGATED' || existingAlert.status === 'RESOLVED') {
      return res.status(400).json({
        success: false,
        message: 'Fraud alert is already investigated or resolved'
      });
    }

    const [updatedAlert] = await db
      .update(fraudAlerts)
      .set({
        status: 'INVESTIGATED',
        updatedAt: new Date()
      })
      .where(eq(fraudAlerts.id, alertId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'FRAUD_ALERT_INVESTIGATED',
      'FRAUD_ALERT',
      alertId,
      { investigatedBy: user.fullName, previousStatus: existingAlert.status }
    );

    res.json({
      success: true,
      message: 'Fraud alert marked as investigated',
      alert: updatedAlert
    });
  } catch (error) {
    console.error('Investigate fraud alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to investigate fraud alert'
    });
  }
});

// POST /api/fraud-alerts/:id/resolve - Resolve fraud alert (Admin only)
router.post('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(alertId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fraud alert ID'
      });
    }

    const [existingAlert] = await db
      .select()
      .from(fraudAlerts)
      .where(eq(fraudAlerts.id, alertId))
      .limit(1);

    if (!existingAlert) {
      return res.status(404).json({
        success: false,
        message: 'Fraud alert not found'
      });
    }

    if (existingAlert.status === 'RESOLVED') {
      return res.status(400).json({
        success: false,
        message: 'Fraud alert is already resolved'
      });
    }

    const [updatedAlert] = await db
      .update(fraudAlerts)
      .set({
        status: 'RESOLVED',
        updatedAt: new Date()
      })
      .where(eq(fraudAlerts.id, alertId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'FRAUD_ALERT_RESOLVED',
      'FRAUD_ALERT',
      alertId,
      { resolvedBy: user.fullName, previousStatus: existingAlert.status }
    );

    res.json({
      success: true,
      message: 'Fraud alert resolved successfully',
      alert: updatedAlert
    });
  } catch (error) {
    console.error('Resolve fraud alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve fraud alert'
    });
  }
});

// DELETE /api/fraud-alerts/:id - Delete fraud alert (Admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(alertId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid fraud alert ID'
      });
    }

    const [existingAlert] = await db
      .select()
      .from(fraudAlerts)
      .where(eq(fraudAlerts.id, alertId))
      .limit(1);

    if (!existingAlert) {
      return res.status(404).json({
        success: false,
        message: 'Fraud alert not found'
      });
    }

    await db
      .delete(fraudAlerts)
      .where(eq(fraudAlerts.id, alertId));

    // Log audit activity
    await logAuditActivity(
      user.id,
      'FRAUD_ALERT_DELETED',
      'FRAUD_ALERT',
      alertId,
      { reason: existingAlert.reason, severity: existingAlert.severity }
    );

    res.json({
      success: true,
      message: 'Fraud alert deleted successfully'
    });
  } catch (error) {
    console.error('Delete fraud alert error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete fraud alert'
    });
  }
});

export default router;
