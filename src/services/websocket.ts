
import WebSocket from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { db } from '../db/config';
import { users, orders, tracking, messages } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: number;
  userRole?: string;
  isAuthenticated?: boolean;
}

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp?: string;
}

export class WebSocketService {
  private wss: WebSocket.Server;
  private clients: Map<number, AuthenticatedWebSocket[]> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws'
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('🔗 WebSocket server initialized');
  }

  private async handleConnection(ws: AuthenticatedWebSocket, request: any) {
    console.log('📱 New WebSocket connection');

    // Extract token from query params or headers
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token') || request.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Authentication token required' },
        timestamp: new Date().toISOString()
      }));
      ws.close();
      return;
    }

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as any;
      
      // Get user from database
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (!user) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'User not found' },
          timestamp: new Date().toISOString()
        }));
        ws.close();
        return;
      }

      // Authenticate WebSocket
      ws.userId = user.id;
      ws.userRole = user.role;
      ws.isAuthenticated = true;

      // Add to clients map
      if (!this.clients.has(user.id)) {
        this.clients.set(user.id, []);
      }
      this.clients.get(user.id)!.push(ws);

      // Send authentication success
      ws.send(JSON.stringify({
        type: 'auth_success',
        data: { 
          userId: user.id,
          role: user.role,
          message: 'Connected successfully'
        },
        timestamp: new Date().toISOString()
      }));

      // Handle messages
      ws.on('message', (message: string) => {
        this.handleMessage(ws, message);
      });

      // Handle disconnect
      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect(ws);
      });

    } catch (error) {
      console.error('WebSocket authentication error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Invalid authentication token' },
        timestamp: new Date().toISOString()
      }));
      ws.close();
    }
  }

  private async handleMessage(ws: AuthenticatedWebSocket, messageData: string) {
    try {
      const message: WebSocketMessage = JSON.parse(messageData);
      
      if (!ws.isAuthenticated || !ws.userId) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Not authenticated' },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      switch (message.type) {
        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong',
            data: { timestamp: new Date().toISOString() },
            timestamp: new Date().toISOString()
          }));
          break;

        case 'join_order_room':
          await this.handleJoinOrderRoom(ws, message.data);
          break;

        case 'leave_order_room':
          await this.handleLeaveOrderRoom(ws, message.data);
          break;

        case 'send_message':
          await this.handleSendMessage(ws, message.data);
          break;

        case 'location_update':
          await this.handleLocationUpdate(ws, message.data);
          break;

        case 'get_order_status':
          await this.handleGetOrderStatus(ws, message.data);
          break;

        case 'start_gps_tracking':
          await this.handleStartGPSTracking(ws, message.data);
          break;

        case 'stop_gps_tracking':
          await this.handleStopGPSTracking(ws, message.data);
          break;

        case 'geofence_event':
          await this.handleGeofenceEvent(ws, message.data);
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'Unknown message type' },
            timestamp: new Date().toISOString()
          }));
      }
    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to process message' },
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async handleJoinOrderRoom(ws: AuthenticatedWebSocket, data: { orderId: number }) {
    try {
      const { orderId } = data;

      // Verify user has access to this order
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Order not found' },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      const hasAccess = order.customerId === ws.userId || 
                       order.merchantId === ws.userId || 
                       order.driverId === ws.userId ||
                       ws.userRole === 'ADMIN';

      if (!hasAccess) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Access denied' },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // Add to order room (you can implement room logic here)
      ws.send(JSON.stringify({
        type: 'order_room_joined',
        data: { 
          orderId,
          message: 'Successfully joined order room'
        },
        timestamp: new Date().toISOString()
      }));

      // Send current order status
      await this.sendOrderUpdate(orderId);

    } catch (error) {
      console.error('Join order room error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to join order room' },
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async handleLeaveOrderRoom(ws: AuthenticatedWebSocket, data: { orderId: number }) {
    ws.send(JSON.stringify({
      type: 'order_room_left',
      data: { 
        orderId: data.orderId,
        message: 'Successfully left order room'
      },
      timestamp: new Date().toISOString()
    }));
  }

  private async handleSendMessage(ws: AuthenticatedWebSocket, data: any) {
    try {
      const { receiverId, message, orderId } = data;

      // Insert message into database
      const [newMessage] = await db
        .insert(messages)
        .values({
          senderId: ws.userId!,
          receiverId,
          message,
          orderId
        })
        .returning();

      // Send to receiver if online
      const receiverClients = this.clients.get(receiverId);
      if (receiverClients) {
        const messagePayload = {
          type: 'new_message',
          data: {
            id: newMessage.id,
            senderId: ws.userId,
            receiverId,
            message,
            orderId,
            createdAt: newMessage.createdAt
          },
          timestamp: new Date().toISOString()
        };

        receiverClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(messagePayload));
          }
        });
      }

      // Confirm to sender
      ws.send(JSON.stringify({
        type: 'message_sent',
        data: {
          id: newMessage.id,
          message: 'Message sent successfully'
        },
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      console.error('Send message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to send message' },
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async handleLocationUpdate(ws: AuthenticatedWebSocket, data: any) {
    try {
      const { orderId, latitude, longitude, status, heading, speed, accuracy } = data;

      // Verify driver is assigned to this order
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order || order.driverId !== ws.userId) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Not authorized to update location for this order' },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // Update driver's current location in profile
      await db
        .update(driverProfiles)
        .set({
          currentLatitude: latitude.toString(),
          currentLongitude: longitude.toString(),
          lastUsedAt: new Date()
        })
        .where(eq(driverProfiles.userId, ws.userId!));

      // Insert detailed tracking entry
      const [newTracking] = await db
        .insert(tracking)
        .values({
          orderId,
          driverId: ws.userId!,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          status
        })
        .returning();

      // Calculate ETA and distance to destination if available
      let eta = null;
      let distanceToDestination = null;
      
      if (order.deliveryLatitude && order.deliveryLongitude) {
        const destLat = parseFloat(order.deliveryLatitude);
        const destLng = parseFloat(order.deliveryLongitude);
        
        distanceToDestination = GeolocationService.haversineDistance(
          { latitude, longitude },
          { latitude: destLat, longitude: destLng }
        );
        
        // Estimate ETA (assuming 30 km/h average speed)
        const estimatedMinutes = (distanceToDestination / 30) * 60;
        eta = new Date(Date.now() + estimatedMinutes * 60 * 1000);
      }

      // Enhanced location data
      const locationData = {
        orderId,
        driverId: ws.userId,
        latitude,
        longitude,
        status,
        heading: heading || null,
        speed: speed || null,
        accuracy: accuracy || null,
        timestamp: newTracking.createdAt,
        eta,
        distanceToDestination,
        trackingId: newTracking.id
      };

      // Broadcast enhanced location update to order participants
      await this.broadcastOrderUpdate(orderId, {
        type: 'location_update',
        data: locationData
      });

      // Send confirmation to driver
      ws.send(JSON.stringify({
        type: 'location_updated',
        data: {
          success: true,
          trackingId: newTracking.id,
          eta,
          distanceToDestination
        },
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      console.error('Location update error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to update location' },
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async handleGetOrderStatus(ws: AuthenticatedWebSocket, data: { orderId: number }) {
    try {
      const { orderId } = data;

      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Order not found' },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // Get latest tracking info
      const [latestTracking] = await db
        .select()
        .from(tracking)
        .where(eq(tracking.orderId, orderId))
        .orderBy(desc(tracking.createdAt))
        .limit(1);

      ws.send(JSON.stringify({
        type: 'order_status',
        data: {
          order,
          tracking: latestTracking
        },
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      console.error('Get order status error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to get order status' },
        timestamp: new Date().toISOString()
      }));
    }
  }

  private handleDisconnect(ws: AuthenticatedWebSocket) {
    if (ws.userId) {
      const userClients = this.clients.get(ws.userId);
      if (userClients) {
        const index = userClients.indexOf(ws);
        if (index > -1) {
          userClients.splice(index, 1);
        }
        
        if (userClients.length === 0) {
          this.clients.delete(ws.userId);
        }
      }
    }
    console.log('📱 WebSocket disconnected');
  }

  // Public methods for broadcasting updates
  public async sendOrderUpdate(orderId: number) {
    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) return;

      const participants = [order.customerId, order.merchantId, order.driverId].filter(Boolean);
      
      const [latestTracking] = await db
        .select()
        .from(tracking)
        .where(eq(tracking.orderId, orderId))
        .orderBy(desc(tracking.createdAt))
        .limit(1);

      const updatePayload = {
        type: 'order_update',
        data: {
          order,
          tracking: latestTracking
        },
        timestamp: new Date().toISOString()
      };

      participants.forEach(userId => {
        const userClients = this.clients.get(userId);
        if (userClients) {
          userClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(updatePayload));
            }
          });
        }
      });
    } catch (error) {
      console.error('Send order update error:', error);
    }
  }

  public async broadcastOrderUpdate(orderId: number, payload: any) {
    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) return;

      const participants = [order.customerId, order.merchantId, order.driverId].filter(Boolean);
      
      participants.forEach(userId => {
        const userClients = this.clients.get(userId);
        if (userClients) {
          userClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                ...payload,
                timestamp: new Date().toISOString()
              }));
            }
          });
        }
      });
    } catch (error) {
      console.error('Broadcast order update error:', error);
    }
  }

  public async sendNotificationToUser(userId: number, notification: any) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      const payload = {
        type: 'notification',
        data: notification,
        timestamp: new Date().toISOString()
      };

      userClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(payload));
        }
      });
    }
  }

  public getConnectedClients(): number {
    return this.wss.clients.size;
  }

  public getUserConnectionCount(userId: number): number {
    return this.clients.get(userId)?.length || 0;
  }

  private async handleStartGPSTracking(ws: AuthenticatedWebSocket, data: { orderId: number }) {
    try {
      const { orderId } = data;

      // Verify driver has access to this order
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order || order.driverId !== ws.userId) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Not authorized to track this order' },
          timestamp: new Date().toISOString()
        }));
        return;
      }

      // Set up GPS tracking session
      ws.send(JSON.stringify({
        type: 'gps_tracking_started',
        data: {
          orderId,
          trackingInterval: 5000, // 5 seconds
          geofenceRadius: 100, // 100 meters
          message: 'GPS tracking started'
        },
        timestamp: new Date().toISOString()
      }));

      // Log tracking start
      await db.insert(auditLogs).values({
        userId: ws.userId!,
        action: 'GPS_TRACKING_STARTED',
        entityType: 'ORDER',
        entityId: orderId,
        details: { driverId: ws.userId }
      });

    } catch (error) {
      console.error('Start GPS tracking error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Failed to start GPS tracking' },
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async handleStopGPSTracking(ws: AuthenticatedWebSocket, data: { orderId: number }) {
    try {
      const { orderId } = data;

      ws.send(JSON.stringify({
        type: 'gps_tracking_stopped',
        data: {
          orderId,
          message: 'GPS tracking stopped'
        },
        timestamp: new Date().toISOString()
      }));

      // Log tracking stop
      await db.insert(auditLogs).values({
        userId: ws.userId!,
        action: 'GPS_TRACKING_STOPPED',
        entityType: 'ORDER',
        entityId: orderId,
        details: { driverId: ws.userId }
      });

    } catch (error) {
      console.error('Stop GPS tracking error:', error);
    }
  }

  private async handleGeofenceEvent(ws: AuthenticatedWebSocket, data: any) {
    try {
      const { orderId, eventType, location, radius } = data;

      // Verify driver has access to this order
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order || order.driverId !== ws.userId) {
        return;
      }

      // Process geofence events
      let statusUpdate = null;
      let notificationMessage = '';

      switch (eventType) {
        case 'ENTERED_PICKUP_ZONE':
          statusUpdate = 'ARRIVED_AT_PICKUP';
          notificationMessage = 'Driver arrived at pickup location';
          break;
        case 'LEFT_PICKUP_ZONE':
          statusUpdate = 'LEFT_PICKUP';
          notificationMessage = 'Driver left pickup location';
          break;
        case 'ENTERED_DELIVERY_ZONE':
          statusUpdate = 'ARRIVED_AT_DELIVERY';
          notificationMessage = 'Driver arrived at delivery location';
          break;
        case 'LEFT_DELIVERY_ZONE':
          statusUpdate = 'LEFT_DELIVERY';
          notificationMessage = 'Driver left delivery location';
          break;
      }

      if (statusUpdate) {
        // Insert tracking entry for geofence event
        await db.insert(tracking).values({
          orderId,
          driverId: ws.userId!,
          latitude: location.latitude.toString(),
          longitude: location.longitude.toString(),
          status: statusUpdate
        });

        // Broadcast geofence event to order participants
        await this.broadcastOrderUpdate(orderId, {
          type: 'geofence_event',
          data: {
            orderId,
            eventType,
            status: statusUpdate,
            location,
            message: notificationMessage,
            timestamp: new Date().toISOString()
          }
        });
      }

    } catch (error) {
      console.error('Geofence event error:', error);
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
