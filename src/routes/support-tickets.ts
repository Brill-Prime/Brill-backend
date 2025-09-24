import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { supportTickets, users, auditLogs } from '../db/schema';
import { eq, and, desc, ilike, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createSupportTicketSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  category: z.string().min(1, 'Category is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().default('MEDIUM'),
  attachments: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.any()).optional().default({})
});

const updateSupportTicketSchema = z.object({
  title: z.string().min(5).optional(),
  description: z.string().min(10).optional(),
  category: z.string().min(1).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  attachments: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

const assignTicketSchema = z.object({
  assignedTo: z.number().int().positive('Admin ID must be a positive integer')
});

// Helper function to generate ticket number
function generateTicketNumber(): string {
  return `TKT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

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

// POST /api/support-tickets - Create a new support ticket
router.post('/', requireAuth, async (req, res) => {
  try {
    const ticketData = createSupportTicketSchema.parse(req.body);
    const user = req.user!;

    const ticketNumber = generateTicketNumber();

    const [newTicket] = await db
      .insert(supportTickets)
      .values({
        userId: user.id,
        ticketNumber,
        title: ticketData.title,
        description: ticketData.description,
        category: ticketData.category,
        priority: ticketData.priority,
        status: 'OPEN',
        attachments: ticketData.attachments,
        metadata: ticketData.metadata
      })
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'SUPPORT_TICKET_CREATED',
      'SUPPORT_TICKET',
      newTicket.id,
      { ticketNumber, category: ticketData.category, priority: ticketData.priority }
    );

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      ticket: newTicket
    });
  } catch (error) {
    console.error('Create support ticket error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create support ticket'
    });
  }
});

// GET /api/support-tickets - List all support tickets
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const { page = '1', limit = '10', status, category, priority, search } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build filter conditions
    const conditions = [];
    
    // Non-admin users can only see their own tickets
    if (user.role !== 'ADMIN') {
      conditions.push(eq(supportTickets.userId, user.id));
    }

    if (status) {
      conditions.push(eq(supportTickets.status, status as string));
    }

    if (category) {
      conditions.push(eq(supportTickets.category, category as string));
    }

    if (priority) {
      conditions.push(eq(supportTickets.priority, priority as string));
    }

    if (search) {
      conditions.push(
        or(
          ilike(supportTickets.title, `%${search}%`),
          ilike(supportTickets.description, `%${search}%`),
          ilike(supportTickets.ticketNumber, `%${search}%`)
        )
      );
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    // Get tickets with user information
    const tickets = await db
      .select({
        id: supportTickets.id,
        ticketNumber: supportTickets.ticketNumber,
        title: supportTickets.title,
        description: supportTickets.description,
        category: supportTickets.category,
        priority: supportTickets.priority,
        status: supportTickets.status,
        attachments: supportTickets.attachments,
        metadata: supportTickets.metadata,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
        resolvedAt: supportTickets.resolvedAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        },
        assignedTo: supportTickets.assignedTo
      })
      .from(supportTickets)
      .leftJoin(users, eq(supportTickets.userId, users.id))
      .where(whereCondition)
      .orderBy(desc(supportTickets.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(supportTickets)
      .where(whereCondition);

    res.json({
      success: true,
      tickets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('List support tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve support tickets'
    });
  }
});

// GET /api/support-tickets/:id - Get support ticket details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    // Build condition - non-admin users can only see their own tickets
    const condition = user.role === 'ADMIN' 
      ? eq(supportTickets.id, ticketId)
      : and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id));

    const [ticket] = await db
      .select({
        id: supportTickets.id,
        ticketNumber: supportTickets.ticketNumber,
        title: supportTickets.title,
        description: supportTickets.description,
        category: supportTickets.category,
        priority: supportTickets.priority,
        status: supportTickets.status,
        attachments: supportTickets.attachments,
        metadata: supportTickets.metadata,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
        resolvedAt: supportTickets.resolvedAt,
        user: {
          id: users.id,
          fullName: users.fullName,
          email: users.email
        },
        assignedTo: supportTickets.assignedTo
      })
      .from(supportTickets)
      .leftJoin(users, eq(supportTickets.userId, users.id))
      .where(condition)
      .limit(1);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    res.json({
      success: true,
      ticket
    });
  } catch (error) {
    console.error('Get support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve support ticket'
    });
  }
});

// PUT /api/support-tickets/:id - Update support ticket details
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const user = req.user!;
    const updateData = updateSupportTicketSchema.parse(req.body);

    if (isNaN(ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    // Check if ticket exists and user has permission
    const condition = user.role === 'ADMIN' 
      ? eq(supportTickets.id, ticketId)
      : and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id));

    const [existingTicket] = await db
      .select()
      .from(supportTickets)
      .where(condition)
      .limit(1);

    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Non-admin users cannot change status to RESOLVED or CLOSED
    if (user.role !== 'ADMIN' && updateData.status && ['RESOLVED', 'CLOSED'].includes(updateData.status)) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can resolve or close tickets'
      });
    }

    const [updatedTicket] = await db
      .update(supportTickets)
      .set({
        ...updateData,
        updatedAt: new Date(),
        resolvedAt: updateData.status === 'RESOLVED' ? new Date() : existingTicket.resolvedAt
      })
      .where(eq(supportTickets.id, ticketId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'SUPPORT_TICKET_UPDATED',
      'SUPPORT_TICKET',
      ticketId,
      { changes: updateData, previousStatus: existingTicket.status }
    );

    res.json({
      success: true,
      message: 'Support ticket updated successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    console.error('Update support ticket error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update support ticket'
    });
  }
});

// POST /api/support-tickets/:id/assign - Assign a ticket to an admin
router.post('/:id/assign', requireAuth, requireAdmin, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const user = req.user!;
    const { assignedTo } = assignTicketSchema.parse(req.body);

    if (isNaN(ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    // Check if ticket exists
    const [existingTicket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1);

    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Verify the assigned user is an admin
    const [assignedUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, assignedTo), eq(users.role, 'ADMIN')))
      .limit(1);

    if (!assignedUser) {
      return res.status(400).json({
        success: false,
        message: 'Assigned user must be an administrator'
      });
    }

    const [updatedTicket] = await db
      .update(supportTickets)
      .set({
        assignedTo,
        status: 'IN_PROGRESS',
        updatedAt: new Date()
      })
      .where(eq(supportTickets.id, ticketId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'SUPPORT_TICKET_ASSIGNED',
      'SUPPORT_TICKET',
      ticketId,
      { assignedTo, assignedToName: assignedUser.fullName }
    );

    res.json({
      success: true,
      message: 'Support ticket assigned successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    console.error('Assign support ticket error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to assign support ticket'
    });
  }
});

// POST /api/support-tickets/:id/resolve - Resolve a ticket
router.post('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const user = req.user!;

    if (isNaN(ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    // Check if ticket exists
    const [existingTicket] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1);

    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    if (existingTicket.status === 'RESOLVED') {
      return res.status(400).json({
        success: false,
        message: 'Ticket is already resolved'
      });
    }

    const [updatedTicket] = await db
      .update(supportTickets)
      .set({
        status: 'RESOLVED',
        resolvedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(supportTickets.id, ticketId))
      .returning();

    // Log audit activity
    await logAuditActivity(
      user.id,
      'SUPPORT_TICKET_RESOLVED',
      'SUPPORT_TICKET',
      ticketId,
      { resolvedBy: user.fullName, previousStatus: existingTicket.status }
    );

    res.json({
      success: true,
      message: 'Support ticket resolved successfully',
      ticket: updatedTicket
    });
  } catch (error) {
    console.error('Resolve support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve support ticket'
    });
  }
});

export default router;