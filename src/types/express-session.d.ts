import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    user?: {
      id: number;
      userId: string;
      email: string;
      fullName: string;
      role: string;
      isVerified: boolean;
      profilePicture?: string;
    };
    lastActivity?: number;
    ipAddress?: string;
    userAgent?: string;
    mfaVerified?: boolean;
    mfaVerifiedAt?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      isAuthenticated(): boolean;
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
  }
}
