
import express from 'express';
import { requireAuth } from '../utils/auth';
import { getWebSocketService } from '../services/websocket';

const router = express.Router();

// Get real-time integration examples
router.get('/', async (req, res) => {
  try {
    const examples = {
      websocket: {
        description: 'WebSocket connection for real-time updates',
        url: `ws://${req.get('host')}/ws`,
        events: [
          { name: 'orderUpdate', description: 'Order status changes' },
          { name: 'driverLocation', description: 'Driver location updates' },
          { name: 'newMessage', description: 'New chat messages' }
        ]
      },
      firebase: {
        description: 'Firebase Realtime Database integration',
        paths: [
          '/orders/{orderId}/status',
          '/drivers/{driverId}/location',
          '/messages/{chatId}'
        ]
      }
    };

    res.json({
      success: true,
      examples
    });
  } catch (error: any) {
    console.error('Get examples error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get examples'
    });
  }
});

// GET /api/realtime-examples/integration - Get integration guide
router.get('/integration', async (req, res) => {
  res.json({
    success: true,
    data: {
      websocketEndpoint: '/ws',
      authentication: {
        method: 'JWT Token',
        description: 'Include JWT token as query parameter: ws://domain/ws?token=YOUR_JWT_TOKEN',
        example: 'ws://localhost:5000/ws?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      },
      messageTypes: {
        client_to_server: [
          {
            type: 'ping',
            description: 'Heartbeat to keep connection alive',
            example: { type: 'ping', data: {} }
          },
          {
            type: 'join_order_room',
            description: 'Join real-time updates for specific order',
            example: { type: 'join_order_room', data: { orderId: 123 } }
          },
          {
            type: 'send_message',
            description: 'Send chat message',
            example: { 
              type: 'send_message', 
              data: { receiverId: 456, message: 'Hello!', orderId: 123 } 
            }
          },
          {
            type: 'location_update',
            description: 'Update driver location (drivers only)',
            example: { 
              type: 'location_update', 
              data: { orderId: 123, latitude: 6.5244, longitude: 3.3792, status: 'en_route' } 
            }
          }
        ],
        server_to_client: [
          {
            type: 'auth_success',
            description: 'Authentication confirmation',
            example: { 
              type: 'auth_success', 
              data: { userId: 123, role: 'CUSTOMER', message: 'Connected successfully' } 
            }
          },
          {
            type: 'new_message',
            description: 'Incoming chat message',
            example: { 
              type: 'new_message', 
              data: { 
                id: 789, 
                senderId: 456, 
                receiverId: 123, 
                message: 'Hello!', 
                orderId: 123 
              } 
            }
          },
          {
            type: 'location_update',
            description: 'Driver location update',
            example: { 
              type: 'location_update', 
              data: { 
                orderId: 123, 
                driverId: 456, 
                latitude: 6.5244, 
                longitude: 3.3792, 
                status: 'en_route' 
              } 
            }
          },
          {
            type: 'order_update',
            description: 'Order status change',
            example: { 
              type: 'order_update', 
              data: { 
                order: { id: 123, status: 'IN_TRANSIT' }, 
                tracking: { latitude: 6.5244, longitude: 3.3792 } 
              } 
            }
          }
        ]
      },
      clientLibraries: {
        javascript: {
          installation: 'Built-in WebSocket API',
          usage: `
const ws = new WebSocket('ws://localhost:5000/ws?token=YOUR_JWT_TOKEN');

ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

// Send a message
ws.send(JSON.stringify({
  type: 'join_order_room',
  data: { orderId: 123 }
}));
          `
        },
        react_native: {
          installation: 'Built-in WebSocket API',
          usage: `
import React, { useEffect, useState } from 'react';

const useWebSocket = (token) => {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const websocket = new WebSocket(\`ws://localhost:5000/ws?token=\${token}\`);
    
    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setMessages(prev => [...prev, message]);
    };

    setWs(websocket);
    return () => websocket.close();
  }, [token]);

  const sendMessage = (message) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  return { messages, sendMessage };
};
          `
        }
      },
      restEndpoints: [
        {
          method: 'GET',
          path: '/api/realtime/status',
          description: 'Get WebSocket service status'
        },
        {
          method: 'GET',
          path: '/api/realtime/order/:orderId/tracking',
          description: 'Get historical tracking data for order'
        },
        {
          method: 'GET',
          path: '/api/realtime/chat/:orderId',
          description: 'Get chat history for order'
        },
        {
          method: 'POST',
          path: '/api/realtime/order-update',
          description: 'Send order status update (triggers real-time notification)'
        }
      ]
    }
  });
});

// GET /api/realtime-examples/test-connection - Test WebSocket connection
router.get('/test-connection', requireAuth, async (req, res) => {
  try {
    const wsService = getWebSocketService();
    
    if (!wsService) {
      return res.status(503).json({
        success: false,
        message: 'WebSocket service not available'
      });
    }

    const userId = req.user!.id;
    const connectionCount = wsService.getUserConnectionCount(String(userId));

    res.json({
      success: true,
      data: {
        userId,
        isConnected: connectionCount > 0,
        connectionCount,
        totalConnections: wsService.getConnectedClients(),
        websocketUrl: `ws://${req.get('host')}/ws?token=YOUR_JWT_TOKEN`,
        testMessage: {
          type: 'ping',
          data: {},
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error('Test WebSocket connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test WebSocket connection'
    });
  }
});

export default router;
