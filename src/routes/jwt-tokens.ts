
import express from 'express';
import { z } from 'zod';
import { JWTService } from '../services/jwt';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

// Refresh access token using refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body);

    const tokenPair = await JWTService.refreshAccessToken(refreshToken);

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      tokens: tokenPair
    });
  } catch (error: any) {
    console.error('Token refresh error:', error);
    
    let statusCode = 401;
    let message = 'Failed to refresh token';

    if (error.message === 'REFRESH_TOKEN_EXPIRED') {
      message = 'Refresh token has expired. Please login again.';
    } else if (error.message === 'INVALID_REFRESH_TOKEN') {
      message = 'Invalid refresh token.';
    } else if (error.message === 'USER_NOT_FOUND_OR_INACTIVE') {
      message = 'User account not found or inactive.';
      statusCode = 403;
    }

    res.status(statusCode).json({
      success: false,
      message,
      code: error.message
    });
  }
});

// Verify token endpoint
router.post('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({
        success: false,
        message: 'Authorization header with Bearer token required'
      });
    }

    const token = authHeader.substring(7);
    const payload = await JWTService.verifyAccessToken(token);

    res.json({
      success: true,
      message: 'Token is valid',
      payload
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      code: error.message
    });
  }
});

// Logout endpoint (for client-side token cleanup)
router.post('/logout', requireAuth, (req, res) => {
  try {
    // Destroy session if it exists
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          console.error('Session destruction error:', err);
        }
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully. Please remove tokens from client storage.'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout'
    });
  }
});

export default router;
