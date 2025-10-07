
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
  const { email, password, fullName, role } = req.body;

  if (!email || !password || !fullName || !role) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await db.insert(users).values({
      email,
      password: hashedPassword,
      fullName,
      role,
    }).returning();

    res.status(201).json({ success: true, message: 'User registered successfully', data: { userId: newUser.id } });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// User Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);

    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
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
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ success: false, message: 'Firebase auth token is required.' });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    const { email, name, uid } = decodedToken;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email not provided by social provider.' });
    }

    let [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);

    if (!user) {
      // Register new user
      const [newUser] = await db.insert(users).values({
        email: email,
        fullName: name || 'Social User',
        role: 'CONSUMER', // Default role for social logins
        isVerified: true, // Social accounts are considered verified
      }).returning();
      user = newUser;
    }

    const jwtToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '7d' });

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const { password, ...userProfile } = user;

    res.json({
      success: true,
      message: 'Social login successful',
      data: { token: jwtToken, user: userProfile },
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
    const { fullName, phone } = req.body;

    const [updatedUser] = await db.update(users).set({ fullName, phone }).where(eq(users.id, userId)).returning();
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

export default router;
