
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { messages, supportTickets, users, auditLogs } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(2000, 'Message too long'),
  metadata: z.record(z.string(), z.any()).optional().default({})
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

// POST /api/support-tickets/:ticketId/messages - Add a message to a support ticket
router.post('/:ticketId/messages', requireAuth, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const user = req.user!;
    const messageData = createMessageSchema.parse(req.body);

    if (isNaN(ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    // Check if ticket exists and user has access
    const condition = user.role === 'ADMIN' 
      ? eq(supportTickets.id, ticketId)
      : and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id));

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(condition)
      .limit(1);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    if (ticket.status === 'CLOSED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add messages to closed tickets'
      });
    }

    // Determine receiver ID
    let receiverId: number;
    if (user.role === 'ADMIN') {
      // Admin is replying to customer
      receiverId = ticket.userId;
    } else {
      // Customer is replying - send to assigned admin or any admin
      if (ticket.assignedTo) {
        receiverId = ticket.assignedTo;
      } else {
        // Find any admin to receive the message
        const [adminUser] = await db
          .select()
          .from(users)
          .where(eq(users.role, 'ADMIN'))
          .limit(1);
        
        if (!adminUser) {
          return res.status(500).json({
            success: false,
            message: 'No administrators available'
          });
        }
        receiverId = adminUser.id;
      }
    }

    const [newMessage] = await db
      .insert(messages)
      .values({
        senderId: user.id,
        receiverId,
        supportTicketId: ticketId,
        message: messageData.message,
        metadata: messageData.metadata
      })
      .returning();

    // Update ticket status if it was resolved and customer is replying
    if (user.role !== 'ADMIN' && ticket.status === 'RESOLVED') {
      await db
        .update(supportTickets)
        .set({
          status: 'OPEN',
          resolvedAt: null,
          updatedAt: new Date()
        })
        .where(eq(supportTickets.id, ticketId));
    } else {
      // Just update the ticket's updatedAt timestamp
      await db
        .update(supportTickets)
        .set({
          updatedAt: new Date()
        })
        .where(eq(supportTickets.id, ticketId));
    }

    // Log audit activity
    await logAuditActivity(
      user.id,
      'SUPPORT_TICKET_MESSAGE_SENT',
      'SUPPORT_TICKET',
      ticketId,
      { messageId: newMessage.id, receiverId }
    );

    // Get the message with sender information
    const [messageWithSender] = await db
      .select({
        id: messages.id,
        message: messages.message,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
        sender: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.id, newMessage.id))
      .limit(1);

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      messageData: messageWithSender
    });
  } catch (error) {
    console.error('Create support ticket message error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// GET /api/support-tickets/:ticketId/messages - Get all messages for a support ticket
router.get('/:ticketId/messages', requireAuth, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const user = req.user!;

    if (isNaN(ticketId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID'
      });
    }

    // Check if ticket exists and user has access
    const condition = user.role === 'ADMIN' 
      ? eq(supportTickets.id, ticketId)
      : and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id));

    const [ticket] = await db
      .select()
      .from(supportTickets)
      .where(condition)
      .limit(1);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    // Get all messages for this ticket
    const ticketMessages = await db
      .select({
        id: messages.id,
        message: messages.message,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
        isRead: messages.isRead,
        sender: {
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(eq(messages.supportTicketId, ticketId))
      .orderBy(desc(messages.createdAt));

    // Mark messages as read if user is the receiver
    const unreadMessageIds = ticketMessages
      .filter(msg => !msg.isRead && msg.sender.id !== user.id)
      .map(msg => msg.id);

    if (unreadMessageIds.length > 0) {
      await db
        .update(messages)
        .set({ isRead: true })
        .where(and(
          eq(messages.supportTicketId, ticketId),
          eq(messages.receiverId, user.id)
        ));
    }

    res.json({
      success: true,
      messages: ticketMessages,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority
      }
    });
  } catch (error) {
    console.error('Get support ticket messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve messages'
    });
  }
});

// PUT /api/support-tickets/:ticketId/messages/:messageId/read - Mark a message as read
router.put('/:ticketId/messages/:messageId/read', requireAuth, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const messageId = parseInt(req.params.messageId);
    const user = req.user!;

    if (isNaN(ticketId) || isNaN(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID or message ID'
      });
    }

    // Verify the message exists and user is the receiver
    const [message] = await db
      .select()
      .from(messages)
      .where(and(
        eq(messages.id, messageId),
        eq(messages.supportTicketId, ticketId),
        eq(messages.receiverId, user.id)
      ))
      .limit(1);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    const [updatedMessage] = await db
      .update(messages)
      .set({ isRead: true })
      .where(eq(messages.id, messageId))
      .returning();

    res.json({
      success: true,
      message: 'Message marked as read',
      messageData: updatedMessage
    });
  } catch (error) {
    console.error('Mark message as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark message as read'
    });
  }
});

// GET /api/support-tickets/messages/unread-count - Get unread message count for user
router.get('/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const user = req.user!;

    const unreadMessages = await db
      .select({
        supportTicketId: messages.supportTicketId
      })
      .from(messages)
      .where(and(
        eq(messages.receiverId, user.id),
        eq(messages.isRead, false)
      ));

    const unreadCount = unreadMessages.length;
    const uniqueTickets = [...new Set(unreadMessages.map(msg => msg.supportTicketId))].length;

    res.json({
      success: true,
      unreadCount,
      uniqueTicketsWithUnreadMessages: uniqueTickets
    });
  } catch (error) {
    console.error('Get unread message count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread message count'
    });
  }
});

export default router;
