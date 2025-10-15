// Load 'ws' dynamically at runtime to avoid ESM/CommonJS export mismatches when bundling
let wsModule: any = null;
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import * as firebaseAdmin from '../config/firebase-admin';

interface AuthenticatedWebSocket {
  // Minimal subset of the ws WebSocket instance used in this service.
  // We avoid importing the runtime 'ws' type here to keep the file bundler-friendly
  // and to preserve the dynamic require usage already present in the file.
  readyState?: number;
  send?: (data: any) => void;

  close?: (code?: number, reason?: string) => void;
  on?: (event: string, cb: (...args: any[]) => void) => void;
  // Authentication metadata attached by this service
  userId?: string;
  userRole?: string;
  isAuthenticated?: boolean;
}

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp?: string;
}

// Lazy-load Firebase Database only if Firebase Admin is initialized
const getDb = () => {
  if (firebaseAdmin) {
    try {
      const { getDatabase } = require('firebase-admin/database');
      return getDatabase();
    } catch (error) {
      console.warn('⚠️ Firebase Admin Database not available');
      return null;
    }
  }
  return null;
};

export class WebSocketService {
  private wss: any;
  private clients: Map<string, AuthenticatedWebSocket[]> = new Map();

  /**
   * Returns the number of currently connected clients (WebSocket connections).
   */
  public getConnectedClients(): number {
    let count = 0;
    for (const arr of this.clients.values()) {
      count += arr.length;
    }
    return count;
  }

  /**
   * Returns the number of connections for a specific userId.
   */
  public getUserConnectionCount(userId: string): number {
    const arr = this.clients.get(userId);
    return arr ? arr.length : 0;
  }

  /**
   * Broadcasts an order update to all participants of the order (customer, merchant, driver).
   * This is a stub; you may want to expand participant lookup as needed.
   */
  public async broadcastOrderUpdate(orderId: number, payload: any) {
    // You may want to fetch order participants from DB here.
    // For now, broadcast to all connected clients.
    for (const arr of this.clients.values()) {
      arr.forEach(client => {
        const OPEN = wsModule?.OPEN || wsModule?.default?.OPEN || 1;
        if (client.readyState === OPEN) {
          client.send(JSON.stringify(payload));
        }
      });
    }
  }

  /**
   * Sends a notification to a specific user (all their connections).
   */
  public async sendNotificationToUser(userId: string, payload: any) {
    const arr = this.clients.get(userId);
    if (arr) {
      arr.forEach(client => {
        const OPEN = wsModule?.OPEN || wsModule?.default?.OPEN || 1;
        if (client.readyState === OPEN) {
          client.send(JSON.stringify({ type: 'notification', data: payload }));
        }
      });
    }
  }

  constructor(server: Server) {
    if (!wsModule) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        wsModule = require('ws');
      } catch (err) {
        console.error('Failed to require ws module', err);
        throw err;
      }
    }

    const WebSocketServer = wsModule.Server || wsModule.default?.Server || wsModule;
    this.wss = new WebSocketServer({
      server,
      path: '/ws'
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('🔗 WebSocket server initialized');
  }

  private async handleConnection(ws: AuthenticatedWebSocket, request: any) {
    console.log('📱 New WebSocket connection');

    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token') || request.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Authentication token required' } }));
      ws.close();
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as any;

      // Use Firebase if available, otherwise use JWT data directly
      const db = getDb();
      if (db) {
        const userRef = db.ref(`users/${decoded.userId}`);
        const userSnapshot = await userRef.get();

        if (!userSnapshot.exists()) {
          ws.send(JSON.stringify({ type: 'error', data: { message: 'User not found' } }));
          ws.close();
          return;
        }

        const user = userSnapshot.val();
        ws.userId = decoded.userId;
        ws.userRole = user.role;
        ws.isAuthenticated = true;
      } else {
        // Fallback: use JWT decoded data directly
        ws.userId = decoded.userId;
        ws.userRole = decoded.role || 'CONSUMER';
        ws.isAuthenticated = true;
      }

      if (!this.clients.has(ws.userId)) {
        this.clients.set(ws.userId, []);
      }
      this.clients.get(ws.userId)!.push(ws);

      ws.send(JSON.stringify({ type: 'auth_success', data: { userId: ws.userId, role: ws.userRole, message: 'Connected successfully' } }));

      ws.on('message', (message: string) => this.handleMessage(ws, message));
      ws.on('close', () => this.handleDisconnect(ws));
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect(ws);
      });

    } catch (error) {
      console.error('WebSocket authentication error:', error);
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid authentication token' } }));
      ws.close();
    }
  }

  private async handleMessage(ws: AuthenticatedWebSocket, messageData: string) {
    try {
      const message: WebSocketMessage = JSON.parse(messageData);
      if (!ws.isAuthenticated || !ws.userId) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Not authenticated' } }));
        return;
      }

      switch (message.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          break;
        case 'location_update':
          await this.handleLocationUpdate(ws, message.data);
          break;
        case 'call_signal':
          await this.handleCallSignal(ws, message.data);
          break;
        case 'join_call':
          await this.handleJoinCall(ws, message.data);
          break;
        case 'leave_call':
          await this.handleLeaveCall(ws, message.data);
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', data: { message: 'Unknown message type' } }));
      }
    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Failed to process message' } }));
    }
  }

  private async handleLocationUpdate(ws: AuthenticatedWebSocket, data: any) {
    if (ws.userRole !== 'DRIVER') {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Only drivers can send location updates.' } }));
      return;
    }

    try {
      const { orderId, latitude, longitude } = data;
      const db = getDb();

      if (db) {
        const trackingRef = db.ref(`tracking/${orderId}`);
        await trackingRef.set({ driverId: ws.userId, latitude, longitude, timestamp: new Date().toISOString() });
        ws.send(JSON.stringify({ type: 'location_updated', data: { success: true } }));
      } else {
        // Firebase not available - log warning
        console.warn('⚠️ Firebase not configured - location tracking disabled');
        ws.send(JSON.stringify({ type: 'warning', data: { message: 'Location tracking temporarily unavailable' } }));
      }
    } catch (error) {
      console.error('Location update error:', error);
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Failed to update location' } }));
    }
  }

  private async handleCallSignal(ws: AuthenticatedWebSocket, data: any) {
    try {
      const { peerId, signalType, signalData } = data;

      await this.sendNotificationToUser(peerId.toString(), {
        type: 'call_signal',
        signalType,
        signalData,
        from: ws.userId
      });

      ws.send(JSON.stringify({ 
        type: 'signal_sent', 
        data: { success: true, peerId } 
      }));
    } catch (error) {
      console.error('Call signal error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        data: { message: 'Failed to send call signal' } 
      }));
    }
  }

  private async handleJoinCall(ws: AuthenticatedWebSocket, data: any) {
    try {
      const { callId, peerId } = data;

      await this.sendNotificationToUser(peerId.toString(), {
        type: 'peer_joined_call',
        callId,
        peerId: ws.userId
      });

      ws.send(JSON.stringify({ 
        type: 'joined_call', 
        data: { success: true, callId } 
      }));
    } catch (error) {
      console.error('Join call error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        data: { message: 'Failed to join call' } 
      }));
    }
  }

  private async handleLeaveCall(ws: AuthenticatedWebSocket, data: any) {
    try {
      const { callId, peerId } = data;

      await this.sendNotificationToUser(peerId.toString(), {
        type: 'peer_left_call',
        callId,
        peerId: ws.userId
      });

      ws.send(JSON.stringify({ 
        type: 'left_call', 
        data: { success: true, callId } 
      }));
    } catch (error) {
      console.error('Leave call error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        data: { message: 'Failed to leave call' } 
      }));
    }
  }

  private handleDisconnect(ws: AuthenticatedWebSocket) {
    if (ws.userId) {
      const userClients = this.clients.get(ws.userId);
      if (userClients) {
        const index = userClients.indexOf(ws);
        if (index > -1) userClients.splice(index, 1);
        if (userClients.length === 0) this.clients.delete(ws.userId);
      }
    }
    console.log('📱 WebSocket disconnected');
  }

  public async broadcastToUser(userId: string, payload: any) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.forEach(client => {
        const OPEN = wsModule?.OPEN || wsModule?.default?.OPEN || 1;
        if (client.readyState === OPEN) {
          client.send(JSON.stringify(payload));
        }
      });
    }
  }
}

let websocketService: WebSocketService | null = null;

export function initializeWebSocket(server: Server): WebSocketService {
  if (!websocketService) {
    websocketService = new WebSocketService(server);
  }
  return websocketService;
}

export function getWebSocketService(): WebSocketService | null {
  return websocketService;
}