
import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db/config';
import { mfaTokens, users, auditLogs } from '../db/schema';
import { eq, and, gte, desc } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const generateMfaTokenSchema = z.object({
  method: z.enum(['SMS', 'EMAIL', 'TOTP']),
  expiresInMinutes: z.number().min(1).max(60).optional().default(10)
});

const verifyMfaTokenSchema = z.object({
  token: z.string().min(4).max(32),
  method: z.enum(['SMS', 'EMAIL', 'TOTP'])
});

// Helper function to generate random token
function generateSecureToken(length: number = 6): string {
  const digits = '0123456789';
  let token = '';
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    token += digits[randomBytes[i] % digits.length];
  }
  
  return token;
}

// Helper function to log audit actions
async function logAuditAction(req: express.Request, action: string, details: any) {
  try {
    await db.insert(auditLogs).values({
      userId: req.user?.id,
      action,
      entityType: 'MFA_TOKEN',
      details,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

// POST /api/mfa-tokens - Generate a new MFA token
router.post('/', requireAuth, async (req, res) => {
  try {
    const validatedData = generateMfaTokenSchema.parse(req.body);
    const userId = req.user!.id;

    // Check if user exists and is active
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found or inactive'
      });
    }

    // Check for existing unexpired tokens (rate limiting)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentTokens = await db
      .select()
      .from(mfaTokens)
      .where(
        and(
          eq(mfaTokens.userId, userId),
          eq(mfaTokens.method, validatedData.method),
          gte(mfaTokens.createdAt, fiveMinutesAgo),
          eq(mfaTokens.isUsed, false)
        )
      );

    if (recentTokens.length > 0) {
      return res.status(429).json({
        success: false,
        message: 'Please wait before requesting a new token',
        retryAfter: 300 // 5 minutes in seconds
      });
    }

    // Generate token based on method
    let token: string;
    let expiresAt: Date;

    switch (validatedData.method) {
      case 'SMS':
      case 'EMAIL':
        token = generateSecureToken(6); // 6-digit token for SMS/Email
        expiresAt = new Date(Date.now() + validatedData.expiresInMinutes * 60 * 1000);
        break;
      case 'TOTP':
        // For TOTP, we generate a temporary token for verification
        token = generateSecureToken(8); // 8-digit token for TOTP
        expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes for TOTP
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid MFA method'
        });
    }

    // Store token in database
    const [newToken] = await db
      .insert(mfaTokens)
      .values({
        userId,
        token: crypto.createHash('sha256').update(token).digest('hex'), // Hash the token for security
        method: validatedData.method,
        expiresAt
      })
      .returning();

    // Log audit action
    await logAuditAction(req, 'MFA_TOKEN_GENERATED', {
      tokenId: newToken.id,
      method: validatedData.method,
      userId
    });

    // For development/testing, include the token in response
    // In production, this would be sent via SMS/Email/App
    const responseData: any = {
      success: true,
      message: 'MFA token generated successfully',
      tokenId: newToken.id,
      method: validatedData.method,
      expiresAt: newToken.expiresAt
    };

    // Only include token in development mode
    if (process.env.NODE_ENV !== 'production') {
      responseData.token = token; // Only for testing
      responseData.note = 'Token included for development testing only';
    }

    res.json(responseData);
  } catch (error) {
    console.error('Generate MFA token error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to generate MFA token'
    });
  }
});

// POST /api/mfa-tokens/verify - Verify an MFA token
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const validatedData = verifyMfaTokenSchema.parse(req.body);
    const userId = req.user!.id;

    // Hash the provided token to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(validatedData.token).digest('hex');

    // Find unexpired, unused token
    const [tokenRecord] = await db
      .select()
      .from(mfaTokens)
      .where(
        and(
          eq(mfaTokens.userId, userId),
          eq(mfaTokens.token, hashedToken),
          eq(mfaTokens.method, validatedData.method),
          gte(mfaTokens.expiresAt, new Date()),
          eq(mfaTokens.isUsed, false)
        )
      )
      .orderBy(desc(mfaTokens.createdAt))
      .limit(1);

    if (!tokenRecord) {
      // Log failed verification attempt
      await logAuditAction(req, 'MFA_TOKEN_VERIFICATION_FAILED', {
        method: validatedData.method,
        userId,
        reason: 'Invalid or expired token'
      });

      return res.status(400).json({
        success: false,
        message: 'Invalid or expired MFA token'
      });
    }

    // Mark token as used
    await db
      .update(mfaTokens)
      .set({
        isUsed: true,
        usedAt: new Date()
      })
      .where(eq(mfaTokens.id, tokenRecord.id));

    // Log successful verification
    await logAuditAction(req, 'MFA_TOKEN_VERIFIED', {
      tokenId: tokenRecord.id,
      method: validatedData.method,
      userId
    });

    res.json({
      success: true,
      message: 'MFA token verified successfully',
      verifiedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Verify MFA token error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to verify MFA token'
    });
  }
});

// GET /api/mfa-tokens/history - Get user's MFA token history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const tokens = await db
      .select({
        id: mfaTokens.id,
        method: mfaTokens.method,
        isUsed: mfaTokens.isUsed,
        createdAt: mfaTokens.createdAt,
        expiresAt: mfaTokens.expiresAt,
        usedAt: mfaTokens.usedAt
      })
      .from(mfaTokens)
      .where(eq(mfaTokens.userId, userId))
      .orderBy(desc(mfaTokens.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: tokens,
      pagination: {
        page,
        limit,
        hasMore: tokens.length === limit
      }
    });
  } catch (error) {
    console.error('MFA token history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve MFA token history'
    });
  }
});

// DELETE /api/mfa-tokens/cleanup - Cleanup expired tokens (for the authenticated user)
router.delete('/cleanup', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Delete expired tokens for the user
    const deletedTokens = await db
      .delete(mfaTokens)
      .where(
        and(
          eq(mfaTokens.userId, userId),
          gte(new Date(), mfaTokens.expiresAt)
        )
      )
      .returning({ id: mfaTokens.id });

    // Log cleanup action
    await logAuditAction(req, 'MFA_TOKENS_CLEANUP', {
      userId,
      deletedCount: deletedTokens.length
    });

    res.json({
      success: true,
      message: 'Expired MFA tokens cleaned up successfully',
      deletedCount: deletedTokens.length
    });
  } catch (error) {
    console.error('MFA token cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired tokens'
    });
  }
});

export default router;
