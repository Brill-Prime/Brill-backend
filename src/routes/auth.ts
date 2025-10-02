import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db/config';
import { users, mfaTokens } from '../db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/email';

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  role: z.enum(['CONSUMER', 'DRIVER', 'MERCHANT', 'ADMIN']).default('CONSUMER')
});

// Registration endpoint with OTP email delivery
// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Find user by email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
  const valid = await bcrypt.compare(password, user.password ?? '');
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Create session
    (req.session as any).userId = user.id;
    (req.session as any).user = {
      id: user.id,
      userId: user.id.toString(),
      email: user.email,
      fullName: user.fullName ?? '',
      role: user.role ?? '',
      isVerified: user.isVerified || false,
      profilePicture: user.profilePicture ?? undefined
    };

    // Generate JWT tokens
    const { JWTService } = await import('../services/jwt');
    const tokenPayload = JWTService.createPayloadFromUser(user);
    const tokens = JWTService.generateTokenPair(tokenPayload);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified || false
      },
      tokens
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
});
router.post('/register', async (req, res) => {
  try {
    const userData = registerSchema.parse(req.body);

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, userData.email))
      .limit(1);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(userData.password, 10);

    // Create user
    const newUsers = await db
      .insert(users)
      .values({
        email: userData.email,
        fullName: userData.fullName,
        phone: userData.phone,
        role: userData.role,
        password: passwordHash,
        createdAt: new Date()
      })
      .returning();

    const newUser = newUsers[0];

    // Generate OTP for email verification
    const otpCode = Math.floor(10000 + Math.random() * 90000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otpCode).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Store OTP in database
    await db
      .insert(mfaTokens)
      .values({
        userId: newUser.id,
        token: hashedOtp,
        method: 'EMAIL',
        expiresAt,
        isUsed: false
      });

    // Send OTP email via Gmail SMTP
    try {
      const emailSent = await sendOTPEmail(userData.email, otpCode, userData.fullName);
      if (!emailSent) {
        console.warn('Failed to send OTP email, but user was created');
      }
    } catch (emailError) {
      console.error('Email service error:', emailError);
    }

    // Create session but mark as unverified
    (req.session as any).userId = newUser.id;
    (req.session as any).user = {
      id: newUser.id,
      userId: newUser.id.toString(),
      email: newUser.email,
      fullName: newUser.fullName ?? '',
      role: newUser.role ?? '',
      isVerified: newUser.isVerified || false,
      profilePicture: newUser.profilePicture ?? undefined
    };

    // Generate JWT tokens
    const { JWTService } = await import('../services/jwt');
    const tokenPayload = JWTService.createPayloadFromUser(newUser);
    const tokens = JWTService.generateTokenPair(tokenPayload);

    res.json({
      success: true,
      requiresEmailVerification: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        isVerified: false
      },
      tokens
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
});

// Forgot password endpoint with Gmail SMTP reset link
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    // Get user by email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        success: true,
        message: 'If an account with that email exists, we have sent a reset link.'
      });
    }

    // Generate reset token
    const resetToken = Math.random().toString(36).substring(2, 15) + 
                      Math.random().toString(36).substring(2, 15);
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

    await db
      .insert(mfaTokens)
      .values({
        userId: user.id,
        token: hashedToken,
        method: 'EMAIL', // Using EMAIL method for password reset
        expiresAt
      });

    // Send reset email via Gmail SMTP
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
    try {
      const emailSent = await sendOTPEmail(email, resetLink, user.fullName);
      if (!emailSent) {
        console.warn('Failed to send password reset email');
      }
    } catch (emailError) {
      console.error('Email service error:', emailError);
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, we have sent a reset link.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
});

// Reset password endpoint
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = z.object({
      token: z.string(),
      newPassword: z.string().min(8)
    }).parse(req.body);

    // Validate token from database
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const [resetData] = await db
      .select({
        id: mfaTokens.id,
        userId: mfaTokens.userId,
        expiresAt: mfaTokens.expiresAt,
        isUsed: mfaTokens.isUsed
      })
      .from(mfaTokens)
      .where(and(
        eq(mfaTokens.token, hashedToken),
        eq(mfaTokens.method, 'EMAIL'),
        gte(mfaTokens.expiresAt, new Date()),
        eq(mfaTokens.isUsed, false)
      ))
      .limit(1);

    if (!resetData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    if (resetData.isUsed) {
      return res.status(400).json({
        success: false,
        message: 'Reset token has already been used'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password
    await db
      .update(users)
      .set({
        password: hashedPassword,
        updatedAt: new Date()
      })
      .where(eq(users.id, resetData.userId));

    // Mark reset token as used
    await db
      .update(mfaTokens)
      .set({ isUsed: true, usedAt: new Date() })
      .where(eq(mfaTokens.id, resetData.id));

    res.json({
      success: true,
      message: 'Password reset successfully. You can now sign in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
});

// Verify email with OTP
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = z.object({
      email: z.string().email(),
      otp: z.string().length(5, 'OTP must be 5 digits')
    }).parse(req.body);

    // Find user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Hash the provided OTP
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    // Find valid OTP token
    const [otpToken] = await db
      .select()
      .from(mfaTokens)
      .where(and(
        eq(mfaTokens.userId, user.id),
        eq(mfaTokens.token, hashedOtp),
        eq(mfaTokens.method, 'EMAIL'),
        gte(mfaTokens.expiresAt, new Date()),
        eq(mfaTokens.isUsed, false)
      ))
      .limit(1);

    if (!otpToken) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code'
      });
    }

    // Mark user as verified
    await db
      .update(users)
      .set({
        isVerified: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    // Mark OTP as used
    await db
      .update(mfaTokens)
      .set({ isUsed: true, usedAt: new Date() })
      .where(eq(mfaTokens.id, otpToken.id));

    // Update session if exists
    if (req.session?.userId === user.id) {
      (req.session as any).user.isVerified = true;
    }

    res.json({
      success: true,
      message: 'Email verified successfully',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: true
      }
    });
  } catch (error: any) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed'
    });
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = z.object({
      email: z.string().email()
    }).parse(req.body);

    // Find user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      // Don't reveal if user exists or not
      return res.json({
        success: true,
        message: 'If an unverified account exists, a new verification code has been sent.'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Generate new OTP
    const otpCode = Math.floor(10000 + Math.random() * 90000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otpCode).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate old OTP tokens for this user
    await db
      .update(mfaTokens)
      .set({ isUsed: true, usedAt: new Date() })
      .where(and(
        eq(mfaTokens.userId, user.id),
        eq(mfaTokens.method, 'EMAIL'),
        eq(mfaTokens.isUsed, false)
      ));

    // Store new OTP
    await db
      .insert(mfaTokens)
      .values({
        userId: user.id,
        token: hashedOtp,
        method: 'EMAIL',
        expiresAt,
        isUsed: false
      });

    // Send OTP email
    try {
      const emailSent = await sendOTPEmail(email, otpCode, user.fullName);
      if (!emailSent) {
        console.warn('Failed to send verification email');
      }
    } catch (emailError) {
      console.error('Email service error:', emailError);
    }

    res.json({
      success: true,
      message: 'If an unverified account exists, a new verification code has been sent.'
    });
  } catch (error: any) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification code'
    });
  }
});

// Social registration (Google, Facebook, Apple, etc.)
const socialRegisterSchema = z.object({
  provider: z.enum(['GOOGLE', 'FACEBOOK', 'APPLE']),
  providerUserId: z.string(),
  email: z.string().email(),
  fullName: z.string().min(2),
  profilePicture: z.string().url().optional(),
  phone: z.string().optional(),
  role: z.enum(['CONSUMER', 'DRIVER', 'MERCHANT', 'ADMIN']).default('CONSUMER')
});

router.post('/register/social', async (req, res) => {
  try {
    const socialData = socialRegisterSchema.parse(req.body);

    // Check if user exists with this email
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, socialData.email))
      .limit(1);

    let user;

    if (existingUser) {
      // User exists - treat as login
      user = existingUser;

      // Update profile picture if provided and not set
      if (socialData.profilePicture && !user.profilePicture) {
        await db
          .update(users)
          .set({
            profilePicture: socialData.profilePicture,
            updatedAt: new Date()
          })
          .where(eq(users.id, user.id));

        user.profilePicture = socialData.profilePicture;
      }
    } else {
      // Create new user - social accounts are auto-verified
      const newUsers = await db
        .insert(users)
        .values({
          email: socialData.email,
          fullName: socialData.fullName,
          phone: socialData.phone,
          role: socialData.role,
          profilePicture: socialData.profilePicture,
          isVerified: true, // Social accounts are pre-verified
          password: null, // No password for social accounts
          createdAt: new Date()
        })
        .returning();

      user = newUsers[0];
    }

    // Create session
    (req.session as any).userId = user.id;
    (req.session as any).user = {
      id: user.id,
      userId: user.id.toString(),
      email: user.email,
      fullName: user.fullName ?? '',
      role: user.role ?? '',
      isVerified: user.isVerified || false,
      profilePicture: user.profilePicture ?? undefined
    };

    // Generate JWT tokens
    const { JWTService } = await import('../services/jwt');
    const tokenPayload = JWTService.createPayloadFromUser(user);
    const tokens = JWTService.generateTokenPair(tokenPayload);

    res.json({
      success: true,
      isNewUser: !existingUser,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified || false,
        profilePicture: user.profilePicture
      },
      tokens
    });
  } catch (error: any) {
    console.error('Social registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Social registration failed'
    });
  }
});

export default router;