import { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { db } from "../db/config";
import { users } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import admin from 'firebase-admin'; // Import Firebase Admin SDK

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
export const generateToken = (payload: any, expiresIn: string | number = '24h'): string => {
  const options: any = {
    expiresIn,
    issuer: 'brillprime-api',
    audience: 'brillprime-app'
  };
  return jwt.sign(payload, JWT_SECRET, options);
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

// Authentication middleware with Firebase-first approach
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please provide a valid token.",
        code: "AUTH_REQUIRED"
      });
    }

    const token = authHeader.substring(7);

    // Primary: Try Firebase token verification
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);

      // Find user in local database
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, decodedToken.email || ''), isNull(users.deletedAt)))
        .limit(1);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User not found. Please register first.",
          code: "USER_NOT_FOUND"
        });
      }

      req.user = {
        id: user.id,
        userId: user.id.toString(),
        fullName: user.fullName,
        email: user.email,
        role: user.role || 'CONSUMER',
        isVerified: user.isVerified || decodedToken.email_verified || false,
        profilePicture: user.profilePicture || undefined
      };
      
      return next();
    } catch (firebaseError: any) {
      // Firebase token verification failed, try JWT as fallback
      if (firebaseError.code === 'auth/id-token-expired') {
        console.log('Firebase token expired, trying JWT fallback');
      } else if (firebaseError.code === 'auth/argument-error') {
        console.log('Invalid Firebase token format, trying JWT fallback');
      } else {
        console.error('Firebase auth error:', firebaseError);
      }

      // Fallback: JWT token verification (for internal API tokens)
      try {
        const decoded: any = await verifyToken(token);

        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, decoded.id || decoded.userId), isNull(users.deletedAt)))
          .limit(1);

        if (!user) {
          return res.status(401).json({
            success: false,
            message: "User not found or account deactivated",
            code: "USER_INVALID"
          });
        }

        req.user = {
          id: user.id,
          userId: user.id.toString(),
          fullName: user.fullName,
          email: user.email,
          role: user.role || 'CONSUMER',
          isVerified: user.isVerified || false,
          profilePicture: user.profilePicture || undefined
        };

        return next();
      } catch (jwtError: any) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
          code: jwtError.message || 'TOKEN_INVALID'
        });
      }
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Optional authentication middleware (for routes that don't strictly require login)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      // Try Firebase token verification first
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);

        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, decodedToken.email || ''), isNull(users.deletedAt)))
          .limit(1);

        if (user) {
          req.user = {
            id: user.id,
            userId: user.id.toString(),
            fullName: user.fullName,
            email: user.email,
            role: user.role || 'CONSUMER',
            isVerified: user.isVerified || decodedToken.email_verified || false,
            profilePicture: user.profilePicture || undefined
          };
        }
      } catch (firebaseError: any) {
        // Try JWT verification as fallback
        try {
          const decoded: any = await verifyToken(token);

          const [user] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, decoded.id || decoded.userId), isNull(users.deletedAt)))
            .limit(1);

          if (user) {
            req.user = {
              id: user.id,
              userId: user.id.toString(),
              fullName: user.fullName,
              email: user.email,
              role: user.role || 'CONSUMER',
              isVerified: user.isVerified || false,
              profilePicture: user.profilePicture || undefined
            };
          }
        } catch (jwtError) {
          // Silently fail for optional auth
          console.log('Token verification failed in optionalAuth');
        }
      }
    }
    
    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next();
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