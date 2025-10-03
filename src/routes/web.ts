
import express from 'express';
import { z } from 'zod';
import { WebFirebaseService } from '../services/webFirebase';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Web app configuration endpoint
router.get('/config', async (req, res) => {
  try {
    const config = {
      apiVersion: '1.0',
      firebase: {
        apiKey: "AIzaSyDWy-NucthigIrHSNYo_nI-o2BY8Rwkod0",
        authDomain: "brillprime.firebaseapp.com",
        projectId: "brillprime",
        storageBucket: "brillprime.firebasestorage.app",
        messagingSenderId: "1064268711919",
        appId: "1:1064268711919:web:de8f36a25600d553a2581a"
      },
      endpoints: {
        base: process.env.API_BASE_URL || 'https://your-repl-name.replit.app',
        auth: '/api/firebase/auth',
        web: '/api/web',
        transactions: '/api/transactions',
        orders: '/api/orders'
      }
    };
    
    res.json({
      success: true,
      config
    });
  } catch (error: any) {
    console.error('Web config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get web configuration'
    });
  }
});

// Web-specific authentication status
router.get('/auth/status', async (req, res) => {
  try {
    res.json({
      success: true,
      authenticated: !!req.session.user,
      user: req.session.user || null
    });
  } catch (error: any) {
    console.error('Auth status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get authentication status'
    });
  }
});

// Initialize web session
router.post('/session/init', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'ID token is required'
      });
    }

    // Verify Firebase ID token
    const { adminAuth } = await import('../config/firebase-admin');
    if (!adminAuth) {
      return res.status(503).json({
        success: false,
        message: 'Firebase Admin not initialized'
      });
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    
    // Find or create user in local database
    const { db } = await import('../db/config');
    const { users } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, decodedToken.email || ''))
      .limit(1);

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          email: decodedToken.email || '',
          fullName: decodedToken.name || decodedToken.email?.split('@')[0] || 'User',
          password: null,
          role: 'CONSUMER',
          isVerified: decodedToken.email_verified || false,
          profilePicture: decodedToken.picture,
          createdAt: new Date()
        })
        .returning();
      
      user = newUser;
    }

    // Set session
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      userId: user.id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role || 'CONSUMER',
      isVerified: user.isVerified || false,
      profilePicture: user.profilePicture
    };

    res.json({
      success: true,
      message: 'Session initialized successfully',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error: any) {
    console.error('Session init error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initialize session'
    });
  }
});

// Clear web session
router.post('/session/clear', async (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        throw err;
      }
      res.json({
        success: true,
        message: 'Session cleared successfully'
      });
    });
  } catch (error: any) {
    console.error('Session clear error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear session'
    });
  }
});

export default router;
