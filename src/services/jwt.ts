
import jwt from 'jsonwebtoken';
import { db } from '../db/config';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY || 'default-development-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-key';

if (process.env.NODE_ENV === 'production' && (JWT_SECRET === 'default-development-secret-key' || !JWT_SECRET)) {
  throw new Error('JWT_SECRET must be set in environment variables for production');
}

export interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  isVerified: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class JWTService {
  // Generate access token (short-lived)
  static generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: '15m', // 15 minutes
      issuer: 'brillprime-api',
      audience: 'brillprime-app'
    });
  }

  // Generate refresh token (long-lived)
  static generateRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: '7d', // 7 days
      issuer: 'brillprime-api',
      audience: 'brillprime-app'
    });
  }

  // Generate both tokens
  static generateTokenPair(payload: TokenPayload): TokenPair {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload)
    };
  }

  // Verify access token
  static verifyAccessToken(token: string): Promise<TokenPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
          if (err.name === 'TokenExpiredError') {
            reject(new Error('ACCESS_TOKEN_EXPIRED'));
          } else if (err.name === 'JsonWebTokenError') {
            reject(new Error('INVALID_ACCESS_TOKEN'));
          } else {
            reject(new Error('ACCESS_TOKEN_VERIFICATION_FAILED'));
          }
        } else {
          resolve(decoded as TokenPayload);
        }
      });
    });
  }

  // Verify refresh token
  static verifyRefreshToken(token: string): Promise<TokenPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, JWT_REFRESH_SECRET, (err, decoded) => {
        if (err) {
          if (err.name === 'TokenExpiredError') {
            reject(new Error('REFRESH_TOKEN_EXPIRED'));
          } else if (err.name === 'JsonWebTokenError') {
            reject(new Error('INVALID_REFRESH_TOKEN'));
          } else {
            reject(new Error('REFRESH_TOKEN_VERIFICATION_FAILED'));
          }
        } else {
          resolve(decoded as TokenPayload);
        }
      });
    });
  }

  // Refresh access token using refresh token
  static async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    try {
      const decoded = await this.verifyRefreshToken(refreshToken);
      
      // Verify user still exists and is active
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (!user || !user.isVerified) {
        throw new Error('USER_NOT_FOUND_OR_INACTIVE');
      }

      const payload: TokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role || 'CONSUMER',
        isVerified: user.isVerified || false
      };

      return this.generateTokenPair(payload);
    } catch (error) {
      throw error;
    }
  }

  // Create payload from user data
  static createPayloadFromUser(user: any): TokenPayload {
    return {
      userId: user.id,
      email: user.email,
      role: user.role || 'CONSUMER',
      isVerified: user.isVerified || false
    };
  }
}
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db/config';
import { jwtTokens, users } from '../db/schema';
import { eq, and, gte } from 'drizzle-orm';

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  sessionId: string;
  tokenType: 'ACCESS' | 'REFRESH';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export class JWTService {
  private static readonly ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'access-secret-key';
  private static readonly REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-key';
  private static readonly ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
  private static readonly REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

  // Generate a secure session ID
  private static generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Create payload from user data
  static createPayloadFromUser(user: any): Omit<JWTPayload, 'tokenType' | 'sessionId'> {
    return {
      userId: user.id,
      email: user.email,
      role: user.role || 'CONSUMER'
    };
  }

  // Generate access token
  static generateAccessToken(payload: Omit<JWTPayload, 'tokenType'>): string {
    const tokenPayload: JWTPayload = {
      ...payload,
      tokenType: 'ACCESS'
    };

    return jwt.sign(tokenPayload, this.ACCESS_TOKEN_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
      issuer: 'brillprime-api',
      audience: 'brillprime-app'
    });
  }

  // Generate refresh token
  static generateRefreshToken(payload: Omit<JWTPayload, 'tokenType'>): string {
    const tokenPayload: JWTPayload = {
      ...payload,
      tokenType: 'REFRESH'
    };

    return jwt.sign(tokenPayload, this.REFRESH_TOKEN_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
      issuer: 'brillprime-api',
      audience: 'brillprime-app'
    });
  }

  // Generate token pair (access + refresh)
  static generateTokenPair(userPayload: Omit<JWTPayload, 'tokenType' | 'sessionId'>): TokenPair {
    const sessionId = this.generateSessionId();
    const payload = { ...userPayload, sessionId };

    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    // Calculate expiry time in seconds
    const expiresIn = this.parseExpiry(this.ACCESS_TOKEN_EXPIRY);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer'
    };
  }

  // Store refresh token in database
  static async storeRefreshToken(
    userId: number,
    refreshToken: string,
    sessionId: string,
    deviceInfo?: any
  ): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      await db.insert(jwtTokens).values({
        userId,
        token: refreshToken,
        tokenType: 'REFRESH',
        sessionId,
        expiresAt,
        deviceInfo: deviceInfo || {},
        isActive: true
      });
    } catch (error) {
      console.error('Error storing refresh token:', error);
      throw new Error('Failed to store refresh token');
    }
  }

  // Verify access token
  static async verifyAccessToken(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, this.ACCESS_TOKEN_SECRET) as JWTPayload;
      
      if (decoded.tokenType !== 'ACCESS') {
        throw new Error('Invalid token type');
      }

      // Verify user still exists and is active
      const [user] = await db
        .select()
        .from(users)
        .where(and(
          eq(users.id, decoded.userId),
          eq(users.isActive, true)
        ))
        .limit(1);

      if (!user) {
        throw new Error('User not found or inactive');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      } else if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      }
      throw error;
    }
  }

  // Verify refresh token
  static async verifyRefreshToken(token: string): Promise<JWTPayload> {
    try {
      const decoded = jwt.verify(token, this.REFRESH_TOKEN_SECRET) as JWTPayload;
      
      if (decoded.tokenType !== 'REFRESH') {
        throw new Error('Invalid token type');
      }

      // Check if token exists in database and is active
      const [storedToken] = await db
        .select()
        .from(jwtTokens)
        .where(and(
          eq(jwtTokens.token, token),
          eq(jwtTokens.userId, decoded.userId),
          eq(jwtTokens.isActive, true),
          gte(jwtTokens.expiresAt, new Date())
        ))
        .limit(1);

      if (!storedToken) {
        throw new Error('Refresh token not found or expired');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      } else if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token expired');
      }
      throw error;
    }
  }

  // Refresh access token using refresh token
  static async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    try {
      const decoded = await this.verifyRefreshToken(refreshToken);
      
      // Get fresh user data
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (!user) {
        throw new Error('User not found');
      }

      // Generate new token pair with same session ID
      const userPayload = this.createPayloadFromUser(user);
      const payload = { ...userPayload, sessionId: decoded.sessionId };

      const accessToken = this.generateAccessToken(payload);
      const newRefreshToken = this.generateRefreshToken(payload);

      // Invalidate old refresh token and store new one
      await this.invalidateRefreshToken(refreshToken);
      await this.storeRefreshToken(user.id, newRefreshToken, decoded.sessionId);

      const expiresIn = this.parseExpiry(this.ACCESS_TOKEN_EXPIRY);

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn,
        tokenType: 'Bearer'
      };
    } catch (error) {
      throw error;
    }
  }

  // Invalidate refresh token
  static async invalidateRefreshToken(token: string): Promise<void> {
    try {
      await db
        .update(jwtTokens)
        .set({
          isActive: false,
          revokedAt: new Date()
        })
        .where(eq(jwtTokens.token, token));
    } catch (error) {
      console.error('Error invalidating refresh token:', error);
    }
  }

  // Invalidate all user sessions
  static async invalidateAllUserTokens(userId: number): Promise<void> {
    try {
      await db
        .update(jwtTokens)
        .set({
          isActive: false,
          revokedAt: new Date()
        })
        .where(and(
          eq(jwtTokens.userId, userId),
          eq(jwtTokens.isActive, true)
        ));
    } catch (error) {
      console.error('Error invalidating user tokens:', error);
      throw new Error('Failed to invalidate user sessions');
    }
  }

  // Get active sessions for user
  static async getUserActiveSessions(userId: number): Promise<any[]> {
    try {
      return await db
        .select({
          id: jwtTokens.id,
          sessionId: jwtTokens.sessionId,
          deviceInfo: jwtTokens.deviceInfo,
          createdAt: jwtTokens.createdAt,
          lastUsedAt: jwtTokens.lastUsedAt,
          expiresAt: jwtTokens.expiresAt
        })
        .from(jwtTokens)
        .where(and(
          eq(jwtTokens.userId, userId),
          eq(jwtTokens.tokenType, 'REFRESH'),
          eq(jwtTokens.isActive, true),
          gte(jwtTokens.expiresAt, new Date())
        ));
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }

  // Parse expiry string to seconds
  private static parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      default: return 900;
    }
  }

  // Cleanup expired tokens
  static async cleanupExpiredTokens(): Promise<number> {
    try {
      const result = await db
        .update(jwtTokens)
        .set({
          isActive: false,
          revokedAt: new Date()
        })
        .where(and(
          eq(jwtTokens.isActive, true),
          gte(new Date(), jwtTokens.expiresAt)
        ));

      return Array.isArray(result) ? result.length : 0;
    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
      return 0;
    }
  }
}

export default JWTService;
