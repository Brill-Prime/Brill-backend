import express from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/config';
import { users, securityLogs, mfaTokens } from '../db/schema';
import { eq, and, isNull, gte } from 'drizzle-orm';
import { requireAuth, generateToken, verifyToken } from '../utils/auth';
import admin from 'firebase-admin';
import EmailService from '../services/email';
import RateLimitingService from '../services/rateLimiting';

const router = express.Router();

const authRateLimiter = RateLimitingService.createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts
  message: 'Too many authentication attempts, please try again later'
});

// User Registration via Firebase
router.post('/register', authRateLimiter, async (req, res) => {
  const { idToken, firstName, lastName, phone, role } = req.body;

  if (!idToken || !firstName || !lastName || !role) {
    return res.status(400).json({ 
      success: false, 
      message: 'Firebase ID token, firstName, lastName, and role are required' 
    });
  }

  try {
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { email, uid: firebaseUid, email_verified } = decodedToken;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email not found in Firebase token' });
    }

    // Check if user already exists
    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const fullName = `${firstName} ${lastName}`;

    // Create user in local database
    const [newUser] = await db.insert(users).values({
      email,
      fullName,
      phone: phone || null,
      role: role.toUpperCase(),
      isVerified: email_verified || false,
      createdAt: new Date()
    }).returning();

    // If email not verified, send verification email via Firebase
    if (!email_verified) {
      try {
        const actionCodeSettings = {
          url: `${process.env.FRONTEND_URL || 'https://brillprime.com'}/verify-email`,
          handleCodeInApp: true
        };
        await admin.auth().generateEmailVerificationLink(email, actionCodeSettings);
      } catch (emailError) {
        console.error('Email verification link generation failed:', emailError);
      }
    }

    // Generate JWT for API access
    const token = jwt.sign({ id: newUser.id, role: newUser.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ id: newUser.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '30d' });

    const { password: _, ...userProfile } = newUser;

    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully', 
      data: { 
        userId: newUser.id,
        firebaseUid,
        token,
        refreshToken,
        user: userProfile,
        emailVerificationSent: !email_verified
      } 
    });

  } catch (error: any) {
    console.error('Registration error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ success: false, message: 'Firebase token expired' });
    }
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// User Login via Firebase
router.post('/login', authRateLimiter, async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, message: 'Firebase ID token is required' });
  }

  try {
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { email, uid: firebaseUid, email_verified } = decodedToken;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email not found in Firebase token' });
    }

    // Find user in local database
    let [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found. Please register first.' 
      });
    }

    // Update last login and verification status
    await db.update(users).set({ 
      lastLoginAt: new Date(),
      isVerified: email_verified || user.isVerified
    }).where(eq(users.id, user.id));

    // Generate JWT for API access
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '30d' });

    const { password: _, ...userProfile } = user;

    res.json({ 
      success: true, 
      message: 'Login successful', 
      data: { 
        token,
        refreshToken,
        firebaseUid,
        user: { ...userProfile, isVerified: email_verified || user.isVerified }
      } 
    });

  } catch (error: any) {
    console.error('Login error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ success: false, message: 'Firebase token expired' });
    }
    if (error.code === 'auth/argument-error') {
      return res.status(400).json({ success: false, message: 'Invalid Firebase token' });
    }
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Social Login/Registration
router.post('/social-login', authRateLimiter, async (req, res) => {
  try {
    const { provider, firebaseUid, email, fullName, photoUrl, role, idToken } = req.body;

    if (!provider || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Provider and email are required.' 
      });
    }

    // Validate provider
    if (!['google', 'apple', 'facebook'].includes(provider)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid provider. Must be google, apple, or facebook.' 
      });
    }

    // Verify Firebase ID token if provided
    let verifiedFirebaseUid = firebaseUid;
    if (idToken) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        verifiedFirebaseUid = decodedToken.uid;

        // Ensure email matches
        if (decodedToken.email !== email) {
          return res.status(400).json({
            success: false,
            message: 'Email mismatch in token verification'
          });
        }
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Firebase token'
        });
      }
    }

    let [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);

    if (!user) {
      // Register new user
      const [newUser] = await db.insert(users).values({
        email: email,
        fullName: fullName || email.split('@')[0],
        role: role || 'CONSUMER',
        isVerified: true,
        profilePicture: photoUrl || null,
        createdAt: new Date()
      }).returning();
      user = newUser;
    } else {
      // Update profile picture and last login
      const updateData: any = { lastLoginAt: new Date() };
      if (photoUrl && !user.profilePicture) {
        updateData.profilePicture = photoUrl;
      }
      await db.update(users).set(updateData).where(eq(users.id, user.id));
      if (photoUrl && !user.profilePicture) {
        user.profilePicture = photoUrl;
      }
    }

    const jwtToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '30d' });

    const { password, ...userProfile } = user;

    res.json({
      success: true,
      message: 'Social login successful',
      data: { 
        token: jwtToken,
        refreshToken,
        user: userProfile,
        firebaseUid: verifiedFirebaseUid
      },
    });
  } catch (error) {
    console.error('Social login error:', error);
    res.status(500).json({ success: false, message: 'Social login failed' });
  }
});

// Get User Profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const { password, ...userProfile } = user;
    res.json({ success: true, data: userProfile });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user profile' });
  }
});

// Update User Profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { firstName, lastName, fullName, email, phone, address } = req.body;

    const updateData: any = { updatedAt: new Date() };

    if (firstName && lastName) {
      updateData.fullName = `${firstName} ${lastName}`;
    } else if (fullName) {
      updateData.fullName = fullName;
    }

    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;
    if (address) updateData.address = address;

    const [updatedUser] = await db.update(users).set(updateData).where(eq(users.id, userId)).returning();
    const { password, ...userProfile } = updatedUser;

    res.json({ success: true, message: 'Profile updated successfully', data: userProfile });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// User Deactivation
router.put('/deactivate', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    await db.update(users)
      .set({ 
          deletedAt: new Date(),
          isActive: false
        })
      .where(eq(users.id, userId));

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    // Send deactivation email if email service is configured
    if (user && user.email) {
      await EmailService.sendEmail(
        user.email,
        'Account Deactivated',
        `<p>Hello ${user.fullName},</p><p>Your account has been successfully deactivated. If you wish to reactivate it, please contact support.</p>`
      );
    }

    res.json({ success: true, message: 'User account deactivated successfully' });
  } catch (error) {
    console.error('Deactivation error:', error);
    res.status(500).json({ success: false, message: 'Failed to deactivate user' });
  }
});

// Request password reset via Firebase
router.post('/request-password-reset', authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Generate password reset link via Firebase
    const actionCodeSettings = {
      url: `${process.env.FRONTEND_URL || 'https://brillprime.com'}/reset-password`,
      handleCodeInApp: true
    };

    const resetLink = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);

    // Optionally send via your own email service for branding
    // Uncomment if you want to use your custom email templates
    // const EmailService = (await import('../services/email')).default;
    // await EmailService.sendPasswordResetEmail(email, email.split('@')[0], resetLink);

    res.json({
      success: true,
      message: 'Password reset email sent successfully',
      // Don't send the link in production for security
      ...(process.env.NODE_ENV === 'development' && { resetLink })
    });
  } catch (error: any) {
    console.error('Password reset error:', error);

    // Don't reveal if user exists
    res.json({
      success: true,
      message: 'If an account exists with that email, a password reset link has been sent.'
    });
  }
});

// Send email verification link
router.post('/send-verification-email', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    const actionCodeSettings = {
      url: `${process.env.FRONTEND_URL || 'https://brillprime.com'}/verify-email`,
      handleCodeInApp: true
    };

    const verificationLink = await admin.auth().generateEmailVerificationLink(user.email, actionCodeSettings);

    res.json({
      success: true,
      message: 'Verification email sent successfully',
      ...(process.env.NODE_ENV === 'development' && { verificationLink })
    });
  } catch (error: any) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification email'
    });
  }
});


    // Verify Firebase token and sync user
router.post('/verify-firebase-token', authRateLimiter, async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Firebase ID token is required'
      });
    }

    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Find or create user
    let [user] = await db.select().from(users)
      .where(and(eq(users.email, decodedToken.email!), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      // Create new user from Firebase token
      const [newUser] = await db.insert(users).values({
        email: decodedToken.email!,
        fullName: decodedToken.name || decodedToken.email!.split('@')[0],
        role: 'CONSUMER',
        isVerified: decodedToken.email_verified || false,
        profilePicture: decodedToken.picture || null,
        createdAt: new Date()
      }).returning();
      user = newUser;
    } else {
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    }

    // Generate JWT tokens
    const jwtToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '30d' });

    const { password, ...userProfile } = user;

    res.json({
      success: true,
      message: 'Firebase token verified successfully',
      data: {
        token: jwtToken,
        refreshToken,
        user: userProfile,
        firebaseUid: decodedToken.uid
      }
    });
  } catch (error) {
    console.error('Firebase token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired Firebase token'
    });
  }
});

// Refresh JWT token
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET!) as any;

    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Get user
    const [user] = await db.select().from(users)
      .where(and(eq(users.id, decoded.id), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new tokens
    const newToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    const newRefreshToken = jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
});

// POST /api/auth/verify-otp - Verify OTP code
router.post('/verify-otp', authRateLimiter, async (req, res) => {
  try {
    const { email, otp, type = 'email' } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Get user
    const [user] = await db.select().from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if OTP exists and is valid in metadata
    const otpData = (user.metadata as any)?.otp;
    
    if (!otpData || !otpData.code || !otpData.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    // Check if OTP has expired
    if (new Date() > new Date(otpData.expiresAt)) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Verify OTP
    if (otpData.code !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code'
      });
    }

    // Mark user as verified and clear OTP
    await db.update(users)
      .set({
        isVerified: true,
        metadata: {
          ...(user.metadata as any || {}),
          otp: null
        },
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    // Generate JWT tokens
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          isVerified: true
        }
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
});

// POST /api/auth/resend-otp - Resend OTP code
router.post('/resend-otp', authRateLimiter, async (req, res) => {
  try {
    const { email, type = 'email' } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Get user
    const [user] = await db.select().from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in user metadata
    await db.update(users)
      .set({
        metadata: {
          ...(user.metadata as any || {}),
          otp: {
            code: otpCode,
            expiresAt: expiresAt.toISOString(),
            type
          }
        },
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    // Send OTP via email
    try {
      await EmailService.sendEmail(
        email,
        'Your OTP Code',
        `<p>Hello ${user.fullName},</p><p>Your OTP code is: <strong>${otpCode}</strong></p><p>This code will expire in 10 minutes.</p>`
      );
    } catch (emailError) {
      console.error('Email send error:', emailError);
      // Continue even if email fails
    }

    res.json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        expiresAt: expiresAt.toISOString(),
        ...(process.env.NODE_ENV === 'development' && { otp: otpCode })
      }
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
});

// POST /api/auth/logout - Logout user
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Log security event
    await db.insert(securityLogs).values({
      userId,
      action: 'LOGOUT',
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'] || 'Unknown',
      success: true,
      details: { timestamp: new Date().toISOString() }
    });

    // Destroy session if exists
    if (req.session) {
      req.session.destroy((err) => {
        if (err) console.error('Session destruction error:', err);
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout'
    });
  }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    let decoded: any;
    try {
      decoded = await verifyToken(refreshToken);
    } catch (error: any) {
      return res.status(401).json({
        success: false,
        message: error.message === 'TOKEN_EXPIRED' ? 'Refresh token expired. Please login again.' : 'Invalid refresh token',
        code: error.message
      });
    }

    // Get user from database
    const [user] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, decoded.id || decoded.userId),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account deactivated'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Generate new tokens
    const accessToken = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    }, '24h');

    const newRefreshToken = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    }, '7d');

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          isVerified: user.isVerified
        }
      }
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

// POST /api/auth/change-password - Change password for authenticated users
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Get user
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user || !user.password) {
      return res.status(404).json({
        success: false,
        message: 'User not found or password not set'
      });
    }

    // Verify current password
    const bcrypt = await import('bcrypt');
    const isValid = await bcrypt.compare(currentPassword, user.password);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await db.update(users)
      .set({
        password: hashedPassword,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log security event
    await db.insert(securityLogs).values({
      userId,
      action: 'PASSWORD_CHANGED',
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'] || 'Unknown',
      success: true,
      details: { timestamp: new Date().toISOString() }
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

// POST /api/auth/verify-email - Verify email with OTP
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Find the OTP token
    const [token] = await db
      .select({
        token: mfaTokens,
        user: users
      })
      .from(mfaTokens)
      .innerJoin(users, eq(mfaTokens.userId, users.id))
      .where(and(
        eq(users.email, email),
        eq(mfaTokens.token, otp),
        eq(mfaTokens.method, 'EMAIL_VERIFICATION'),
        eq(mfaTokens.isUsed, false)
      ))
      .limit(1);

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Check if token is expired
    if (new Date() > token.token.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Mark token as used
    await db
      .update(mfaTokens)
      .set({
        isUsed: true,
        usedAt: new Date()
      })
      .where(eq(mfaTokens.id, token.token.id));

    // Mark user as verified
    await db
      .update(users)
      .set({
        isVerified: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, token.user.id));

    // Log security event
    await db.insert(securityLogs).values({
      userId: token.user.id,
      action: 'EMAIL_VERIFIED',
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'] || 'Unknown',
      success: true,
      details: { email }
    });

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify email'
    });
  }
});

// POST /api/auth/resend-otp - Resend verification OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user
    const [user] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.email, email),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message: 'If the email exists, a new OTP has been sent'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Check rate limiting - max 3 OTPs per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTokens = await db
      .select()
      .from(mfaTokens)
      .where(and(
        eq(mfaTokens.userId, user.id),
        eq(mfaTokens.method, 'EMAIL_VERIFICATION'),
        gte(mfaTokens.createdAt, oneHourAgo)
      ));

    if (recentTokens.length >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please try again later.'
      });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP token
    await db.insert(mfaTokens).values({
      userId: user.id,
      token: otp,
      method: 'EMAIL_VERIFICATION',
      expiresAt,
      isUsed: false
    });

    // Send email (implement your email service)
    // await EmailService.sendVerificationEmail(user.email, otp);
    console.log(`Verification OTP for ${user.email}: ${otp}`);

    // Log security event
    await db.insert(securityLogs).values({
      userId: user.id,
      action: 'OTP_RESENT',
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'] || 'Unknown',
      success: true,
      details: { email }
    });

    res.json({
      success: true,
      message: 'A new verification code has been sent to your email'
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP'
    });
  }
});

export default router;