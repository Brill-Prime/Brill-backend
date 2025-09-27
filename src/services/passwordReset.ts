
import crypto from 'crypto';
import { db } from '../db/config';
import { users, mfaTokens } from '../db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { sendOTPEmail } from './email';

export interface PasswordResetRequest {
  email: string;
  resetCode?: string;
  newPassword?: string;
}

export class PasswordResetService {
  // Step 1: Request password reset
  static async requestPasswordReset(email: string): Promise<boolean> {
    try {
      // Get user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        // Don't reveal if user exists for security
        return true;
      }

      // Generate 6-digit reset code
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      const hashedCode = crypto.createHash('sha256').update(resetCode).digest('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry

      // Store reset code in database
      await db
        .insert(mfaTokens)
        .values({
          userId: user.id,
          token: hashedCode,
          method: 'PASSWORD_RESET',
          expiresAt,
          isUsed: false
        });

      // Send reset code via email
      const emailSent = await sendOTPEmail(
        email, 
        resetCode, 
        user.fullName,
        'Your BrillPrime Password Reset Code',
        `Your password reset code is: <b>${resetCode}</b><br>This code will expire in 15 minutes.<br>If you didn't request this, please ignore this email.`
      );

      return emailSent;
    } catch (error) {
      console.error('Password reset request error:', error);
      return false;
    }
  }

  // Step 2: Verify reset code
  static async verifyResetCode(email: string, resetCode: string): Promise<{ valid: boolean; token?: string }> {
    try {
      // Get user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        return { valid: false };
      }

      const hashedCode = crypto.createHash('sha256').update(resetCode).digest('hex');

      // Check if reset code exists and is valid
      const [resetData] = await db
        .select()
        .from(mfaTokens)
        .where(and(
          eq(mfaTokens.userId, user.id),
          eq(mfaTokens.token, hashedCode),
          eq(mfaTokens.method, 'PASSWORD_RESET'),
          gte(mfaTokens.expiresAt, new Date()),
          eq(mfaTokens.isUsed, false)
        ))
        .limit(1);

      if (!resetData) {
        return { valid: false };
      }

      // Generate temporary token for password reset
      const tempToken = crypto.randomBytes(32).toString('hex');
      
      return { 
        valid: true, 
        token: tempToken
      };
    } catch (error) {
      console.error('Reset code verification error:', error);
      return { valid: false };
    }
  }

  // Step 3: Complete password reset
  static async completePasswordReset(email: string, resetCode: string, newPassword: string): Promise<boolean> {
    try {
      // Get user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        return false;
      }

      const hashedCode = crypto.createHash('sha256').update(resetCode).digest('hex');

      // Verify reset code again
      const [resetData] = await db
        .select()
        .from(mfaTokens)
        .where(and(
          eq(mfaTokens.userId, user.id),
          eq(mfaTokens.token, hashedCode),
          eq(mfaTokens.method, 'PASSWORD_RESET'),
          gte(mfaTokens.expiresAt, new Date()),
          eq(mfaTokens.isUsed, false)
        ))
        .limit(1);

      if (!resetData) {
        return false;
      }

      // Hash new password
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update user password
      await db
        .update(users)
        .set({
          password: hashedPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, user.id));

      // Mark reset code as used
      await db
        .update(mfaTokens)
        .set({ 
          isUsed: true, 
          usedAt: new Date() 
        })
        .where(eq(mfaTokens.id, resetData.id));

      return true;
    } catch (error) {
      console.error('Password reset completion error:', error);
      return false;
    }
  }
}
