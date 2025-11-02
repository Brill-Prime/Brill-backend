import express from 'express';
import { db } from '../db/config';
import { messages, users } from '../db/schema';
import { eq, or, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

const messageSchema = z.object({
  receiverId: z.number().int().positive(),
  message: z.string().min(1).max(5000),
  orderId: z.number().int().positive().optional()
});

const createConversationSchema = z.object({
  orderId: z.string()
});

// GET /api/conversations - Get user conversations
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    // Get unique conversation partners with last message
    const conversations = await db
      .select({
        partnerId: sql<number>`CASE WHEN ${messages.senderId} = ${userId} THEN ${messages.receiverId} ELSE ${messages.senderId} END`,
        partnerName: users.fullName,
        partnerEmail: users.email,
        partnerProfilePicture: users.profilePicture,
        lastMessage: messages.message,
        lastMessageTime: messages.createdAt,
        isRead: messages.isRead,
        senderId: messages.senderId
      })
      .from(messages)
      .leftJoin(
        users,
        sql`${users.id} = CASE WHEN ${messages.senderId} = ${userId} THEN ${messages.receiverId} ELSE ${messages.senderId} END`
      )
      .where(
        or(
          eq(messages.senderId, userId),
          eq(messages.receiverId, userId)
        )
      )
      .orderBy(desc(messages.createdAt))
      .groupBy(
        sql`CASE WHEN ${messages.senderId} = ${userId} THEN ${messages.receiverId} ELSE ${messages.senderId} END`,
        users.fullName,
        users.email,
        users.profilePicture,
        messages.message,
        messages.createdAt,
        messages.isRead,
        messages.senderId
      );

    res.json({
      success: true,
      data: conversations
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Failed to get conversations' });
  }
});

// POST /api/conversations - Create/get conversation for order
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const validation = createConversationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors
      });
    }

    const { orderId } = validation.data;

    // Find existing conversation or create new one
    let conversation = await db.query.conversations.findFirst({
      where: (conversations, { eq, and }) =>
        and(
          eq(conversations.orderId, orderId),
          or(
            eq(conversations.userId1, userId),
            eq(conversations.userId2, userId)
          )
        ),
    });

    if (!conversation) {
      // Determine the other user in the conversation (assuming orderId implies a known counterparty)
      // This is a placeholder; you'll need logic to determine the other user based on orderId
      const counterPartyId = 1; // Replace with actual logic

      const [newConversation] = await db
        .insert(db.conversations) // Assuming you have a 'conversations' table in your schema
        .values({
          userId1: userId,
          userId2: counterPartyId,
          orderId: orderId
        })
        .returning();
      conversation = newConversation;
    }

    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        orderId: conversation.orderId
      }
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create conversation' });
  }
});

// GET /api/conversations/:conversationId/messages
router.get('/:conversationId/messages', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { conversationId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const messages = await db.query.messages.findMany({
      where: (messages, { eq, and, or }) =>
        or(
          and(eq(messages.conversationId, conversationId), eq(messages.senderId, userId)),
          and(eq(messages.conversationId, conversationId), eq(messages.receiverId, userId))
        ),
      limit: parseInt(offset as string),
      offset: parseInt(limit as string),
      orderBy: desc(messages.createdAt)
    });

    // Mark messages as read if the current user is the receiver
    await db.update(db.messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.receiverId, userId),
          eq(messages.isRead, false)
        )
      );

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: 'Failed to get messages' });
  }
});

// POST /api/conversations/:conversationId/messages
router.post('/:conversationId/messages', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { conversationId } = req.params;
    const validation = sendMessageSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors
      });
    }

    const { message, messageType } = validation.data;

    // Verify that the user is part of the conversation
    const conversation = await db.query.conversations.findFirst({
      where: (conversations, { eq, or }) =>
        or(
          and(eq(conversations.id, conversationId), eq(conversations.userId1, userId)),
          and(eq(conversations.id, conversationId), eq(conversations.userId2, userId))
        ),
    });

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to send messages in this conversation'
      });
    }

    const receiverId = conversation.userId1 === userId ? conversation.userId2 : conversation.userId1;

    const [newMessage] = await db
      .insert(db.messages)
      .values({
        conversationId: conversationId,
        senderId: userId,
        receiverId: receiverId,
        message,
        messageType,
        isRead: false
      })
      .returning();

    res.json({
      success: true,
      data: newMessage,
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// PUT /api/conversations/:conversationId/read
router.put('/:conversationId/read', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { conversationId } = req.params;

    // Mark all messages in the conversation as read for the current user
    await db.update(db.messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.receiverId, userId),
          eq(messages.isRead, false)
        )
      );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark messages as read' });
  }
});

// DELETE /api/conversations/:partnerId - Delete conversation with a specific partner
router.delete('/:partnerId', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const partnerId = parseInt(req.params.partnerId);

    if (isNaN(partnerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid partner ID'
      });
    }

    // Verify that a conversation exists between these users
    const existingMessages = await db.query.messages.findFirst({
      where: (messages, { eq, and, or }) =>
        or(
          and(
            eq(messages.senderId, userId),
            eq(messages.receiverId, partnerId)
          ),
          and(
            eq(messages.senderId, partnerId),
            eq(messages.receiverId, userId)
          )
        )
    });

    if (!existingMessages) {
      return res.status(404).json({
        success: false,
        message: 'No conversation found with this user'
      });
    }

    // Delete all messages between current user and partner
    await db
      .delete(messages)
      .where(
        or(
          and(
            eq(messages.senderId, userId),
            eq(messages.receiverId, partnerId)
          ),
          and(
            eq(messages.senderId, partnerId),
            eq(messages.receiverId, userId)
          )
        )
      );

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete conversation'
    });
  }
});

export default router;