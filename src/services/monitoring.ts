
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

      // Log slow requests with context
      if (duration > 1000) {
        const user = (req as any).user;
        console.warn(`Slow request: ${req.method} ${req.path} - ${duration}ms`, {
          userId: user?.id,
          statusCode: res.statusCode,
          userAgent: req.headers['user-agent']
        });
      }

      // Log errors with details
      if (res.statusCode >= 500) {
        console.error(`Server error: ${req.method} ${req.path}`, {
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip
        });
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
