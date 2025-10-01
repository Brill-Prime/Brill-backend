
export interface WebSocketClientOptions {
  token: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onMessage?: (message: any) => void;
  onError?: (error: any) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: WebSocketClientOptions;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isConnecting = false;

  constructor(url: string, options: WebSocketClientOptions) {
    this.url = url;
    this.options = {
      autoReconnect: true,
      reconnectInterval: 3000,
      ...options
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting || this.isConnected()) {
        resolve();
        return;
      }

      this.isConnecting = true;
      const wsUrl = `${this.url}?token=${encodeURIComponent(this.options.token)}`;
      
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('🔗 WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.options.onConnect?.();
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket disconnected:', event.code, event.reason);
          this.isConnecting = false;
          this.options.onDisconnect?.();
          
          if (this.options.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => {
              this.reconnectAttempts++;
              console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
              this.connect();
            }, this.options.reconnectInterval);
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.options.onMessage?.(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnecting = false;
          this.options.onError?.(error);
          reject(error);
        };

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: any): boolean {
    if (!this.isConnected()) {
      console.warn('WebSocket not connected');
      return false;
    }

    try {
      this.ws!.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString()
      }));
      return true;
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      return false;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Convenience methods
  joinOrderRoom(orderId: number): boolean {
    return this.send({
      type: 'join_order_room',
      data: { orderId }
    });
  }

  leaveOrderRoom(orderId: number): boolean {
    return this.send({
      type: 'leave_order_room',
      data: { orderId }
    });
  }

  sendMessage(receiverId: number, message: string, orderId?: number): boolean {
    return this.send({
      type: 'send_message',
      data: { receiverId, message, orderId }
    });
  }

  updateLocation(orderId: number, latitude: number, longitude: number, status: string): boolean {
    return this.send({
      type: 'location_update',
      data: { orderId, latitude, longitude, status }
    });
  }

  getOrderStatus(orderId: number): boolean {
    return this.send({
      type: 'get_order_status',
      data: { orderId }
    });
  }

  ping(): boolean {
    return this.send({
      type: 'ping',
      data: {}
    });
  }
}

// Example usage for frontend applications
export function createWebSocketClient(baseUrl: string, token: string): WebSocketClient {
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
  
  return new WebSocketClient(wsUrl, {
    token,
    onConnect: () => console.log('Connected to real-time service'),
    onDisconnect: () => console.log('Disconnected from real-time service'),
    onMessage: (message) => {
      console.log('Received message:', message);
      
      // Handle different message types
      switch (message.type) {
        case 'auth_success':
          console.log('Authentication successful');
          break;
        case 'new_message':
          console.log('New chat message:', message.data);
          break;
        case 'location_update':
          console.log('Location update:', message.data);
          break;
        case 'order_update':
          console.log('Order update:', message.data);
          break;
        case 'notification':
          console.log('Notification:', message.data);
          break;
        case 'error':
          console.error('WebSocket error:', message.data);
          break;
      }
    },
    onError: (error) => console.error('WebSocket error:', error),
    autoReconnect: true,
    reconnectInterval: 3000
  });
}
