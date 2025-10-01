
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

class RateLimitingService {
  // Auth endpoints rate limiting (stricter)
  static authLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 auth requests per windowMs
    message: {
      error: 'Too many authentication attempts, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // General API rate limiting
  static apiLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // WebSocket connection rate limiting
  static wsLimit = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 WebSocket connections per minute
    message: {
      error: 'Too many WebSocket connection attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export default RateLimitingService;

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}

class RateLimitingService {
  private static requests: Map<string, { count: number; resetTime: number }> = new Map();

  static createRateLimit(options: RateLimitOptions) {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = this.getClientKey(req);
      const now = Date.now();
      
      // Clean up expired entries
      this.cleanup();
      
      const clientData = this.requests.get(key);
      
      if (!clientData || now > clientData.resetTime) {
        // First request or window expired
        this.requests.set(key, {
          count: 1,
          resetTime: now + options.windowMs
        });
        return next();
      }
      
      if (clientData.count >= options.maxRequests) {
        return res.status(429).json({
          success: false,
          message: options.message || 'Too many requests',
          retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
        });
      }
      
      clientData.count++;
      next();
    };
  }

  private static getClientKey(req: Request): string {
    // Use user ID if authenticated, otherwise use IP
    const userId = (req as any).user?.id;
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  }

  private static cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requests.entries()) {
      if (now > data.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  // Predefined rate limits
  static readonly authLimit = this.createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many authentication attempts'
  });

  static readonly apiLimit = this.createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    message: 'Too many API requests'
  });

  static readonly strictLimit = this.createRateLimit({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
    message: 'Rate limit exceeded'
  });
}

export default RateLimitingService;
