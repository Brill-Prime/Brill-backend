
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/config';
import { users } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import EmailService from '../services/email';
import { generateVerificationCode } from '../utils/helpers';
import admin from 'firebase-admin';

const router = express.Router();

// User Registration
router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, phone, role, firebaseUid } = req.body;

  if (!email || !password || !firstName || !lastName || !role) {
    return res.status(400).json({ success: false, message: 'Email, password, firstName, lastName, and role are required' });
  }

  try {
    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const fullName = `${firstName} ${lastName}`;

    const [newUser] = await db.insert(users).values({
      email,
      password: hashedPassword,
      fullName,
      phone: phone || null,
      role: role.toUpperCase(),
      createdAt: new Date()
    }).returning();

    const token = jwt.sign({ id: newUser.id, role: newUser.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });

    const { password: _, ...userProfile } = newUser;

    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully', 
      data: { 
        userId: newUser.id,
        token,
        user: userProfile
      } 
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// User Login
router.post('/login', async (req, res) => {
  const { email, password, firebaseUid } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    const [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Support both password and firebaseUid login
    if (password) {
      if (!user.password) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    } else if (firebaseUid) {
      // Firebase authentication - trust the firebaseUid for now
      // In production, verify this with Firebase Admin SDK
    } else {
      return res.status(400).json({ success: false, message: 'Password or firebaseUid is required' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const { password: _, ...userProfile } = user;
    res.json({ success: true, message: 'Login successful', data: { token, user: userProfile } });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Social Login/Registration
router.post('/social-login', async (req, res) => {
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

// Verify Firebase token and sync user
router.post('/verify-firebase-token', async (req, res) => {
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

export default router;
