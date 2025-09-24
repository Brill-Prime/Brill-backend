
import express from 'express';
import { db } from '../db/config';
import { deliveryFeedback, users, orders, auditLogs } from '../db/schema';
import { eq, isNull, desc, and, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createDeliveryFeedbackSchema = z.object({
  orderId: z.number().int().positive(),
  driverId: z.number().int().positive(),
  feedbackType: z.string().min(1).max(50),
  driverRating: z.number().int().min(1).max(5).optional(),
  serviceRating: z.number().int().min(1).max(5).optional(),
  deliveryTimeRating: z.number().int().min(1).max(5).optional(),
  deliveryQuality: z.enum(['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'TERRIBLE']).optional(),
  wouldRecommend: z.boolean().optional(),
  issuesReported: z.string().optional(),
  customerRating: z.number().int().min(1).max(5).optional(),
  deliveryComplexity: z.enum(['EASY', 'MODERATE', 'DIFFICULT', 'VERY_DIFFICULT']).optional(),
  customerCooperation: z.enum(['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'TERRIBLE']).optional(),
  paymentIssues: z.boolean().optional(),
  comment: z.string().optional(),
  additionalFeedback: z.string().optional()
});

const updateDeliveryFeedbackSchema = createDeliveryFeedbackSchema.partial().omit({
  orderId: true,
  driverId: true
});

// Helper function to log audit events
async function logAuditEvent(userId: number, action: string, entityId: number, details: any) {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'DELIVERY_FEEDBACK',
      entityId,
      details,
      ipAddress: '127.0.0.1',
      userAgent: 'API'
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

// POST /api/delivery-feedback - Submit delivery feedback
router.post('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const validatedData = createDeliveryFeedbackSchema.parse(req.body);

    // Verify the order exists and is completed
    const orderExists = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, validatedData.orderId),
        eq(orders.status, 'DELIVERED'),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!orderExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or not yet delivered'
      });
    }

    const order = orderExists[0];

    // Verify user is the customer of this order
    if (currentUser.id !== order.customerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the customer can submit feedback for this order'
      });
    }

    // Check if feedback already exists for this order
    const existingFeedback = await db
      .select()
      .from(deliveryFeedback)
      .where(and(
        eq(deliveryFeedback.orderId, validatedData.orderId),
        eq(deliveryFeedback.customerId, currentUser.id),
        isNull(deliveryFeedback.deletedAt)
      ))
      .limit(1);

    if (existingFeedback.length) {
      return res.status(400).json({
        success: false,
        message: 'Feedback already submitted for this order'
      });
    }

    // Verify the driver exists
    const driverExists = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, validatedData.driverId),
        eq(users.role, 'DRIVER'),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!driverExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Create the feedback
    const newFeedback = await db
      .insert(deliveryFeedback)
      .values({
        ...validatedData,
        customerId: currentUser.id,
        createdAt: new Date()
      })
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DELIVERY_FEEDBACK_CREATED',
      newFeedback[0].id,
      { orderId: validatedData.orderId, driverId: validatedData.driverId }
    );

    res.status(201).json({
      success: true,
      message: 'Delivery feedback submitted successfully',
      data: newFeedback[0]
    });
  } catch (error) {
    console.error('Create delivery feedback error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to submit delivery feedback'
    });
  }
});

// GET /api/delivery-feedback - List all delivery feedback
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const feedbackType = req.query.feedbackType as string;
    const driverRating = req.query.driverRating as string;
    const deliveryQuality = req.query.deliveryQuality as string;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [isNull(deliveryFeedback.deletedAt)];

    // Non-admin users can only see feedback they submitted or received
    if (currentUser.role !== 'ADMIN') {
      conditions.push(
        or(
          eq(deliveryFeedback.customerId, currentUser.id),
          eq(deliveryFeedback.driverId, currentUser.id)
        )!
      );
    }

    if (search) {
      conditions.push(ilike(deliveryFeedback.comment, `%${search}%`));
    }

    if (feedbackType) {
      conditions.push(eq(deliveryFeedback.feedbackType, feedbackType));
    }

    if (driverRating) {
      conditions.push(eq(deliveryFeedback.driverRating, parseInt(driverRating)));
    }

    if (deliveryQuality) {
      conditions.push(eq(deliveryFeedback.deliveryQuality, deliveryQuality as any));
    }

    const allFeedback = await db
      .select({
        id: deliveryFeedback.id,
        orderId: deliveryFeedback.orderId,
        customerId: deliveryFeedback.customerId,
        customerName: users.fullName,
        driverId: deliveryFeedback.driverId,
        feedbackType: deliveryFeedback.feedbackType,
        driverRating: deliveryFeedback.driverRating,
        serviceRating: deliveryFeedback.serviceRating,
        deliveryTimeRating: deliveryFeedback.deliveryTimeRating,
        deliveryQuality: deliveryFeedback.deliveryQuality,
        wouldRecommend: deliveryFeedback.wouldRecommend,
        issuesReported: deliveryFeedback.issuesReported,
        customerRating: deliveryFeedback.customerRating,
        deliveryComplexity: deliveryFeedback.deliveryComplexity,
        customerCooperation: deliveryFeedback.customerCooperation,
        paymentIssues: deliveryFeedback.paymentIssues,
        comment: deliveryFeedback.comment,
        additionalFeedback: deliveryFeedback.additionalFeedback,
        createdAt: deliveryFeedback.createdAt
      })
      .from(deliveryFeedback)
      .leftJoin(users, eq(deliveryFeedback.customerId, users.id))
      .where(and(...conditions))
      .orderBy(desc(deliveryFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: deliveryFeedback.id })
      .from(deliveryFeedback)
      .where(and(...conditions));

    const totalPages = Math.ceil(totalCount.length / limit);

    res.json({
      success: true,
      data: allFeedback,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: totalCount.length,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('List delivery feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery feedback'
    });
  }
});

// GET /api/delivery-feedback/:id - Get delivery feedback details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const feedbackId = parseInt(req.params.id);
    
    if (isNaN(feedbackId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feedback ID'
      });
    }

    const feedbackDetails = await db
      .select({
        id: deliveryFeedback.id,
        orderId: deliveryFeedback.orderId,
        customerId: deliveryFeedback.customerId,
        customerName: users.fullName,
        customerEmail: users.email,
        driverId: deliveryFeedback.driverId,
        feedbackType: deliveryFeedback.feedbackType,
        driverRating: deliveryFeedback.driverRating,
        serviceRating: deliveryFeedback.serviceRating,
        deliveryTimeRating: deliveryFeedback.deliveryTimeRating,
        deliveryQuality: deliveryFeedback.deliveryQuality,
        wouldRecommend: deliveryFeedback.wouldRecommend,
        issuesReported: deliveryFeedback.issuesReported,
        customerRating: deliveryFeedback.customerRating,
        deliveryComplexity: deliveryFeedback.deliveryComplexity,
        customerCooperation: deliveryFeedback.customerCooperation,
        paymentIssues: deliveryFeedback.paymentIssues,
        comment: deliveryFeedback.comment,
        additionalFeedback: deliveryFeedback.additionalFeedback,
        createdAt: deliveryFeedback.createdAt
      })
      .from(deliveryFeedback)
      .leftJoin(users, eq(deliveryFeedback.customerId, users.id))
      .where(and(
        eq(deliveryFeedback.id, feedbackId),
        isNull(deliveryFeedback.deletedAt)
      ))
      .limit(1);

    if (!feedbackDetails.length) {
      return res.status(404).json({
        success: false,
        message: 'Delivery feedback not found'
      });
    }

    const feedback = feedbackDetails[0];

    // Check access permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== feedback.customerId && 
        currentUser.id !== feedback.driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: feedback
    });
  } catch (error) {
    console.error('Get delivery feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery feedback'
    });
  }
});

// GET /api/delivery-feedback/order/:id - List feedback by order
router.get('/order/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const orderId = parseInt(req.params.id);
    
    if (isNaN(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and user has access
    const orderExists = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!orderExists.length) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = orderExists[0];

    // Check access permissions
    if (currentUser.role !== 'ADMIN' && 
        currentUser.id !== order.customerId && 
        currentUser.id !== order.driverId &&
        currentUser.id !== order.merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const feedbackList = await db
      .select({
        id: deliveryFeedback.id,
        orderId: deliveryFeedback.orderId,
        customerId: deliveryFeedback.customerId,
        customerName: users.fullName,
        driverId: deliveryFeedback.driverId,
        feedbackType: deliveryFeedback.feedbackType,
        driverRating: deliveryFeedback.driverRating,
        serviceRating: deliveryFeedback.serviceRating,
        deliveryTimeRating: deliveryFeedback.deliveryTimeRating,
        deliveryQuality: deliveryFeedback.deliveryQuality,
        wouldRecommend: deliveryFeedback.wouldRecommend,
        issuesReported: deliveryFeedback.issuesReported,
        customerRating: deliveryFeedback.customerRating,
        deliveryComplexity: deliveryFeedback.deliveryComplexity,
        customerCooperation: deliveryFeedback.customerCooperation,
        paymentIssues: deliveryFeedback.paymentIssues,
        comment: deliveryFeedback.comment,
        additionalFeedback: deliveryFeedback.additionalFeedback,
        createdAt: deliveryFeedback.createdAt
      })
      .from(deliveryFeedback)
      .leftJoin(users, eq(deliveryFeedback.customerId, users.id))
      .where(and(
        eq(deliveryFeedback.orderId, orderId),
        isNull(deliveryFeedback.deletedAt)
      ))
      .orderBy(desc(deliveryFeedback.createdAt));

    res.json({
      success: true,
      data: feedbackList,
      orderInfo: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount
      }
    });
  } catch (error) {
    console.error('Get feedback by order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch feedback for order'
    });
  }
});

// PUT /api/delivery-feedback/:id - Update delivery feedback (admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const feedbackId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(feedbackId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feedback ID'
      });
    }

    const validatedData = updateDeliveryFeedbackSchema.parse(req.body);

    // Check if feedback exists
    const existingFeedback = await db
      .select()
      .from(deliveryFeedback)
      .where(and(
        eq(deliveryFeedback.id, feedbackId),
        isNull(deliveryFeedback.deletedAt)
      ))
      .limit(1);

    if (!existingFeedback.length) {
      return res.status(404).json({
        success: false,
        message: 'Delivery feedback not found'
      });
    }

    const updatedFeedback = await db
      .update(deliveryFeedback)
      .set(validatedData)
      .where(eq(deliveryFeedback.id, feedbackId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DELIVERY_FEEDBACK_UPDATED',
      feedbackId,
      { changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Delivery feedback updated successfully',
      data: updatedFeedback[0]
    });
  } catch (error) {
    console.error('Update delivery feedback error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update delivery feedback'
    });
  }
});

// DELETE /api/delivery-feedback/:id - Soft delete delivery feedback (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const feedbackId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(feedbackId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid feedback ID'
      });
    }

    // Check if feedback exists
    const existingFeedback = await db
      .select()
      .from(deliveryFeedback)
      .where(and(
        eq(deliveryFeedback.id, feedbackId),
        isNull(deliveryFeedback.deletedAt)
      ))
      .limit(1);

    if (!existingFeedback.length) {
      return res.status(404).json({
        success: false,
        message: 'Delivery feedback not found'
      });
    }

    await db
      .update(deliveryFeedback)
      .set({ deletedAt: new Date() })
      .where(eq(deliveryFeedback.id, feedbackId));

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'DELIVERY_FEEDBACK_DELETED',
      feedbackId,
      { orderId: existingFeedback[0].orderId }
    );

    res.json({
      success: true,
      message: 'Delivery feedback deleted successfully'
    });
  } catch (error) {
    console.error('Delete delivery feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete delivery feedback'
    });
  }
});

export default router;
