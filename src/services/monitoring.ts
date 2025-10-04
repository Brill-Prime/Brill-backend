
import { Request, Response, NextFunction } from 'express';

interface Metrics {
  requests: number;
  errors: number;
  avgResponseTime: number;
  totalResponseTime: number;
}

class MonitoringService {
  private static metrics: Metrics = {
    requests: 0,
    errors: 0,
    avgResponseTime: 0,
    totalResponseTime: 0
  };

  static trackRequest(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      this.metrics.requests++;
      this.metrics.totalResponseTime += duration;
      this.metrics.avgResponseTime = this.metrics.totalResponseTime / this.metrics.requests;
      
      if (res.statusCode >= 400) {
        this.metrics.errors++;
      }

      // Log slow requests
      if (duration > 1000) {
        console.warn(`Slow request: ${req.method} ${req.path} - ${duration}ms`);
      }
    });

    next();
  }

  static getMetrics(): Metrics {
    return { ...this.metrics };
  }

  static resetMetrics() {
    this.metrics = {
      requests: 0,
      errors: 0,
      avgResponseTime: 0,
      totalResponseTime: 0
    };
  }
}

export default MonitoringService;
