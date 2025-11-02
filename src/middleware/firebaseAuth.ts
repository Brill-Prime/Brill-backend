import { Request, Response, NextFunction, RequestHandler } from 'express';
import { adminAuth } from '../config/firebase-admin';

export interface FirebaseUser {
    id: number;
    userId: string;  // This will store the Firebase UID
    email: string;
    fullName: string;
    role: string;
    isVerified: boolean;
    profilePicture?: string;
}

export interface AuthRequest extends Request {
    user: FirebaseUser;
}

export const firebaseAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided',
                code: 'TOKEN_MISSING'
            });
        }

        const token = authHeader.split('Bearer ')[1];

        try {
            const decodedToken = await adminAuth?.verifyIdToken(token);

            if (!decodedToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token',
                    code: 'TOKEN_INVALID'
                });
            }

            // Attach user info to request
            req.user = {
                id: 0, // This will be populated from the database
                userId: decodedToken.uid,
                email: decodedToken.email || '',
                fullName: decodedToken.name || '',
                role: decodedToken.role as string || 'CONSUMER',
                isVerified: false, // This will be populated from the database
            };

            next();
        } catch (verifyError: any) {
            if (verifyError?.code === 'auth/id-token-expired') {
                return res.status(401).json({
                    success: false,
                    message: 'Token expired',
                    code: 'TOKEN_EXPIRED'
                });
            }

            return res.status(401).json({
                success: false,
                message: 'Invalid token',
                code: 'TOKEN_INVALID'
            });
        }
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            code: 'SERVER_ERROR'
        });
    }
};

// Optional middleware to check specific roles
export const requireRole = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user?.role || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }
        next();
    };
};