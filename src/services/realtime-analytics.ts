
import { EventEmitter } from 'events';
import { db } from '../db/config';
import { users, orders, transactions } from '../db/schema';
import { count, gte, eq, and } from 'drizzle-orm';

interface SystemMetrics {
  activeUsers: number;
  activeOrders: number;
  transactionsPerMinute: number;
  responseTime: number;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
}

export class RealTimeAnalytics extends EventEmitter {
  private metricsInterval: NodeJS.Timeout | null = null;
  private currentMetrics: SystemMetrics;
  private memoryStore = new Map<string, any>();

  constructor() {
    super();
    this.currentMetrics = this.getEmptyMetrics();
    this.startMetricsCollection();
  }

  private getEmptyMetrics(): SystemMetrics {
    return {
      activeUsers: 0,
      activeOrders: 0,
      transactionsPerMinute: 0,
      responseTime: 0,
      errorRate: 0,
      cpuUsage: 0,
      memoryUsage: 0
    };
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
        await this.broadcastMetrics();
      } catch (error) {
        console.error('Metrics collection error:', error);
      }
    }, 30000); // Every 30 seconds
  }

  private async collectMetrics(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60000);

    try {
      let activeOrdersCount = [{ count: 0 }];
      let recentTransactionsCount = [{ count: 0 }];
      
      try {
        // Wrap each database query in its own try-catch to handle missing tables
        activeOrdersCount = await db.select({ count: count() })
          .from(orders)
          .where(eq(orders.status, 'PENDING'));
      } catch (err) {
        console.warn('Unable to query orders table, it may not exist yet:', err.message);
      }
      
      try {
        recentTransactionsCount = await db.select({ count: count() })
          .from(transactions)
          .where(gte(transactions.createdAt, oneMinuteAgo));
      } catch (err) {
        console.warn('Unable to query transactions table, it may not exist yet:', err.message);
      }

      const systemMetrics = this.getSystemMetrics();

      this.currentMetrics = {
        activeUsers: this.memoryStore.get('activeUsers') || 0,
        activeOrders: Number(activeOrdersCount[0]?.count || 0),
        transactionsPerMinute: Number(recentTransactionsCount[0]?.count || 0),
        responseTime: 0,
        errorRate: 0,
        cpuUsage: systemMetrics.cpuUsage,
        memoryUsage: systemMetrics.memoryUsage
      };

    } catch (error) {
      console.error('Error collecting metrics:', error);
      // Use empty metrics on error
      this.currentMetrics = this.getEmptyMetrics();
    }
  }

  private getSystemMetrics(): any {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      cpuUsage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000),
      memoryUsage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    };
  }

  private async broadcastMetrics(): Promise<void> {
    const io = (global as any).io;
    if (io) {
      io.emit('realtime_metrics', {
        ...this.currentMetrics,
        timestamp: Date.now()
      });
    }

    this.emit('metrics_updated', this.currentMetrics);
  }

  async trackMetric(name: string, value: number): Promise<void> {
    this.memoryStore.set(name, value);
  }

  async recordResponseTime(time: number): Promise<void> {
    const times = this.memoryStore.get('response_times') || [];
    times.push(time);
    if (times.length > 100) times.shift();
    this.memoryStore.set('response_times', times);
  }

  getCurrentMetrics(): SystemMetrics {
    return { ...this.currentMetrics };
  }

  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}

export const realTimeAnalytics = new RealTimeAnalytics();

export const responseTimeMiddleware = (req: any, res: any, next: any) => {
  const startTime = Date.now();
  
  res.on('finish', async () => {
    const responseTime = Date.now() - startTime;
    await realTimeAnalytics.recordResponseTime(responseTime);
  });
  
  next();
};
