
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
  expiresIn?: number;
  tokenType?: string;
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
