import { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { db } from "../db/config";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

// JWT Secret from environment
const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || 'default-development-secret-key';
if (process.env.NODE_ENV === 'production' && (JWT_SECRET === 'default-development-secret-key' || !JWT_SECRET)) {
  throw new Error('JWT_SECRET must be set in environment variables for production');
}

// Session timeout (30 minutes)
const SESSION_TIMEOUT = 30 * 60 * 1000;

export interface AuthRequest extends Request {
  user?: {
    id: number;
    userId: string;
    email: string;
    fullName: string;
    role: string;
    isVerified: boolean;
    profilePicture?: string;
  };
}

// Generate JWT token
export const generateToken = (payload: any, expiresIn: string = '24h'): string => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: 'brillprime-api',
    audience: 'brillprime-app'
  });
};

// Verify JWT token
export const verifyToken = (token: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          reject(new Error('TOKEN_EXPIRED'));
        } else if (err.name === 'JsonWebTokenError') {
          reject(new Error('INVALID_TOKEN'));
        } else {
          reject(new Error('TOKEN_VERIFICATION_FAILED'));
        }
      } else {
        resolve(decoded);
      }
    });
  });
};

// Hash password
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

// Compare password
export const comparePassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return await bcrypt.compare(password, hashedPassword);
};

// Authentication middleware
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check for session-based auth first
    if (req.session?.userId) {
      req.user = {
        id: req.session.userId,
        userId: req.session.userId.toString(),
        fullName: req.session.user?.fullName || '',
        email: req.session.user?.email || '',
        role: req.session.user?.role || 'CONSUMER',
        isVerified: req.session.user?.isVerified || false,
        profilePicture: req.session.user?.profilePicture
      };
      return next();
    }

    // Check for JWT token in headers
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      try {
        const decoded: any = await verifyToken(token);

        // Verify user still exists and is active
        const user = await db
          .select()
          .from(users)
          .where(eq(users.id, decoded.id || decoded.userId))
          .limit(1);

        if (!user.length || !user[0].isVerified) {
          return res.status(401).json({
            success: false,
            message: "User not found or not verified",
            code: "USER_INVALID"
          });
        }

        // Set user in request
        req.user = {
          id: user[0].id,
          userId: user[0].id.toString(),
          fullName: user[0].fullName,
          email: user[0].email,
          role: user[0].role || 'CONSUMER',
          isVerified: user[0].isVerified || false,
          profilePicture: user[0].profilePicture || undefined
        };

        next();
      } catch (error: any) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
          code: error.message
        });
      }
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTH_REQUIRED"
      });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Admin authorization middleware
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authorization error'
    });
  }
};

// Driver authorization middleware
export const requireDriver = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'DRIVER' && req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Driver access required'
    });
  }

  next();
};

// Middleware to require specific role
export const requireRole = (allowedRoles: string | string[]) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTH_REQUIRED"
      });
    }

    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${roles.join(', ')}`,
        code: "INSUFFICIENT_PERMISSIONS"
      });
    }

    next();
  };
};

// Check if user owns resource or is admin
export const requireOwnershipOrAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (currentUser.role === 'ADMIN' || currentUser.id === targetUserId) {
      next();
    } else {
      res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  } catch (error) {
    console.error('Ownership middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authorization error'
    });
  }
};

// Middleware to require verified user
export const requireVerified = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.isVerified) {
    return res.status(403).json({
      success: false,
      message: "Account verification required",
      code: "VERIFICATION_REQUIRED"
    });
  }
  next();
};

// Session management
export const updateLastActivity = (req: Request) => {
  if (req.session) {
    req.session.lastActivity = Date.now();
  }
};

export const isSessionExpired = (req: Request): boolean => {
  if (!req.session?.lastActivity) {
    return true;
  }

  return Date.now() - req.session.lastActivity > SESSION_TIMEOUT;
};

// Authentication setup middleware
export const setupAuth = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check for session timeout
    if (req.session?.lastActivity) {
      const timeSinceLastActivity = Date.now() - req.session.lastActivity;
      if (timeSinceLastActivity > SESSION_TIMEOUT) {
        req.session.destroy((err) => {
          if (err) console.error('Session destruction error:', err);
        });
        return res.status(401).json({
          success: false,
          message: "Session expired",
          code: "SESSION_EXPIRED"
        });
      }
    }

    // Add isAuthenticated method to request
    req.isAuthenticated = function() {
      return !!(req.session?.userId);
    };

    // Add user to request if authenticated
    if (req.session?.user) {
      req.user = req.session.user;
    }

    // Update last activity
    if (req.session?.userId) {
      req.session.lastActivity = Date.now();

      // Verify IP and User Agent for security
      const currentIP = req.ip || req.connection.remoteAddress;
      const currentUA = req.headers['user-agent'];

      if (req.session.ipAddress && req.session.ipAddress !== currentIP) {
        console.warn(`IP address mismatch for user ${req.session.userId}: ${req.session.ipAddress} vs ${currentIP}`);
      }

      if (req.session.userAgent && req.session.userAgent !== currentUA) {
        console.warn(`User agent mismatch for user ${req.session.userId}`);
      }
    }

    next();
  };
};

// Aliases for consistency
export const auth = requireAuth;
export const authenticateUser = requireAuth;
export const verifyPassword = comparePassword;