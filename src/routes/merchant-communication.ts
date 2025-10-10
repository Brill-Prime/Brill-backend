import express from 'express';
import { db } from '../db/config';
import { messages, users } from '../db/schema';
import { eq, and, or, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { z } from 'zod';
import { getWebSocketService } from '../services/websocket';

const router = express.Router();

const sendMessageSchema = z.object({
  recipientId: z.number().int().positive(),
  content: z.string().min(1),
});

// Send a message to a user or merchant
router.post('/merchants/:id/communication', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);
    const validatedData = sendMessageSchema.parse(req.body);

    // You can only send messages from your own account
    if (currentUser.id !== merchantId) {
        return res.status(403).json({ 
            success: false, 
            message: 'Access denied. You can only send messages from your own account.' 
        });
    }

    const recipient = await db.select().from(users).where(eq(users.id, validatedData.recipientId));

    if (recipient.length === 0) {
        return res.status(404).json({ success: false, message: 'Recipient not found' });
    }

    const newMessage = await db.insert(messages).values({
        senderId: currentUser.id,
        recipientId: validatedData.recipientId,
        content: validatedData.content,
    }).returning();

    // Emit a real-time event to the recipient using the WebSocketService
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.broadcastToUser(validatedData.recipientId.toString(), { type: 'new_message', data: newMessage[0] });
    }

    res.status(201).json({ 
        success: true, 
        message: 'Message sent successfully', 
        data: newMessage[0] 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,
      });
    }
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// Get conversation history with a user
router.get('/merchants/:id/communication/:recipientId', requireAuth, async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);
    const recipientId = parseInt(req.params.recipientId);

    if (currentUser.id !== merchantId) {
        return res.status(403).json({ 
            success: false, 
            message: 'Access denied. You can only view your own conversations.' 
        });
    }

    const conversation = await db.select().from(messages).where(
        and(
            or(
                and(eq(messages.senderId, currentUser.id), eq(messages.recipientId, recipientId)),
                and(eq(messages.senderId, recipientId), eq(messages.recipientId, currentUser.id))
            ),
            isNull(messages.deletedAt)
        )
    ).orderBy(messages.createdAt);

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve conversation' });
  }
});

export default router;
