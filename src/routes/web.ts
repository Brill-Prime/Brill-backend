
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

    // Here you would verify the Firebase ID token
    // For now, we'll trust the client-side authentication
    req.session.user = {
      id: req.body.userId,
      userId: req.body.userId,
      email: req.body.email,
      fullName: req.body.fullName || '',
      role: req.body.role || 'USER',
      isVerified: req.body.isVerified || false,
      profilePicture: req.body.profilePicture
    };

    res.json({
      success: true,
      message: 'Session initialized successfully'
    });
  } catch (error: any) {
    console.error('Session init error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize session'
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
