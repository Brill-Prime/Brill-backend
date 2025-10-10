
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { orders, users } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { getWebSocketService } from '../services/websocket';

const router = express.Router();

// Validation schemas
const initiateCallSchema = z.object({
  orderId: z.number().int().positive(),
  calleeId: z.number().int().positive(),
  callType: z.enum(['AUDIO', 'VIDEO'])
});

const callSignalSchema = z.object({
  callId: z.string().min(1),
  signalType: z.enum(['OFFER', 'ANSWER', 'ICE_CANDIDATE']),
  signalData: z.any()
});

const endCallSchema = z.object({
  callId: z.string().min(1),
  duration: z.number().optional(),
  reason: z.enum(['COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED']).optional()
});

// POST /api/calls/initiate - Initiate a call
router.post('/initiate', requireAuth, async (req, res) => {
  try {
    const validatedData = initiateCallSchema.parse(req.body);
    const caller = req.user!;

    // Verify order exists and user has access
    const [order] = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.id, validatedData.orderId),
        isNull(orders.deletedAt)
      ))
      .limit(1);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Verify user is part of this order
    const isParticipant = 
      order.customerId === caller.id ||
      order.merchantId === caller.id ||
      order.driverId === caller.id;

    if (!isParticipant && caller.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to call participants of this order'
      });
    }

    // Get callee details
    const [callee] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        photoUrl: users.photoUrl,
        role: users.role
      })
      .from(users)
      .where(eq(users.id, validatedData.calleeId))
      .limit(1);

    if (!callee) {
      return res.status(404).json({
        success: false,
        message: 'Callee not found'
      });
    }

    // Generate unique call ID
    const callId = `call_${Date.now()}_${caller.id}_${validatedData.calleeId}`;

    // Send call initiation via WebSocket
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.sendNotificationToUser(validatedData.calleeId.toString(), {
        type: 'INCOMING_CALL',
        callId,
        caller: {
          id: caller.id,
          name: caller.fullName,
          photoUrl: caller.photoUrl,
          role: caller.role
        },
        callType: validatedData.callType,
        orderId: validatedData.orderId,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: {
        callId,
        callee: {
          id: callee.id,
          name: callee.fullName,
          photoUrl: callee.photoUrl,
          role: callee.role
        },
        callType: validatedData.callType,
        orderId: validatedData.orderId
      }
    });
  } catch (error) {
    console.error('Initiate call error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to initiate call'
    });
  }
});

// POST /api/calls/signal - Send WebRTC signaling data
router.post('/signal', requireAuth, async (req, res) => {
  try {
    const validatedData = callSignalSchema.parse(req.body);
    const user = req.user!;

    // Extract peer ID from call ID (format: call_timestamp_callerId_calleeId)
    const callParts = validatedData.callId.split('_');
    if (callParts.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'Invalid call ID format'
      });
    }

    const callerId = parseInt(callParts[2]);
    const calleeId = parseInt(callParts[3]);
    
    // Determine peer (the other participant)
    const peerId = user.id === callerId ? calleeId : callerId;

    // Send signaling data to peer via WebSocket
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.sendNotificationToUser(peerId.toString(), {
        type: 'CALL_SIGNAL',
        callId: validatedData.callId,
        signalType: validatedData.signalType,
        signalData: validatedData.signalData,
        from: user.id
      });
    }

    res.json({
      success: true,
      message: 'Signal sent successfully'
    });
  } catch (error) {
    console.error('Call signal error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send signal'
    });
  }
});

// POST /api/calls/accept - Accept an incoming call
router.post('/accept', requireAuth, async (req, res) => {
  try {
    const { callId } = req.body;
    const user = req.user!;

    if (!callId) {
      return res.status(400).json({
        success: false,
        message: 'Call ID is required'
      });
    }

    // Extract caller ID from call ID
    const callParts = callId.split('_');
    const callerId = parseInt(callParts[2]);

    // Notify caller that call was accepted
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.sendNotificationToUser(callerId.toString(), {
        type: 'CALL_ACCEPTED',
        callId,
        acceptedBy: {
          id: user.id,
          name: user.fullName,
          photoUrl: user.photoUrl
        },
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Call accepted',
      data: { callId }
    });
  } catch (error) {
    console.error('Accept call error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept call'
    });
  }
});

// POST /api/calls/reject - Reject an incoming call
router.post('/reject', requireAuth, async (req, res) => {
  try {
    const { callId, reason } = req.body;
    const user = req.user!;

    if (!callId) {
      return res.status(400).json({
        success: false,
        message: 'Call ID is required'
      });
    }

    // Extract caller ID from call ID
    const callParts = callId.split('_');
    const callerId = parseInt(callParts[2]);

    // Notify caller that call was rejected
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.sendNotificationToUser(callerId.toString(), {
        type: 'CALL_REJECTED',
        callId,
        rejectedBy: {
          id: user.id,
          name: user.fullName
        },
        reason: reason || 'User declined',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Call rejected',
      data: { callId }
    });
  } catch (error) {
    console.error('Reject call error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject call'
    });
  }
});

// POST /api/calls/end - End an active call
router.post('/end', requireAuth, async (req, res) => {
  try {
    const validatedData = endCallSchema.parse(req.body);
    const user = req.user!;

    // Extract peer ID from call ID
    const callParts = validatedData.callId.split('_');
    const callerId = parseInt(callParts[2]);
    const calleeId = parseInt(callParts[3]);
    
    const peerId = user.id === callerId ? calleeId : callerId;

    // Notify peer that call ended
    const wsService = getWebSocketService();
    if (wsService) {
      await wsService.sendNotificationToUser(peerId.toString(), {
        type: 'CALL_ENDED',
        callId: validatedData.callId,
        endedBy: user.id,
        duration: validatedData.duration,
        reason: validatedData.reason || 'COMPLETED',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Call ended successfully',
      data: {
        callId: validatedData.callId,
        duration: validatedData.duration
      }
    });
  } catch (error) {
    console.error('End call error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to end call'
    });
  }
});

// GET /api/calls/ice-servers - Get STUN/TURN server configuration
router.get('/ice-servers', requireAuth, async (req, res) => {
  try {
    // Return public STUN servers (you can add your own TURN servers)
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    // If you have TURN servers, add them here
    if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({
        urls: process.env.TURN_SERVER_URL,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      } as any);
    }

    res.json({
      success: true,
      data: { iceServers }
    });
  } catch (error) {
    console.error('Get ICE servers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ICE servers'
    });
  }
});

export default router;
