import express from 'express';
import { z } from 'zod';
import { FirebaseService } from '../services/firebase';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

const createDocumentSchema = z.object({
  collection: z.string().min(1, 'Collection name is required'),
  docId: z.string().min(1, 'Document ID is required'),
  data: z.record(z.string(), z.any())
});

const updateDocumentSchema = z.object({
  collection: z.string().min(1, 'Collection name is required'),
  docId: z.string().min(1, 'Document ID is required'),
  data: z.record(z.string(), z.any())
});

// Authentication routes
router.post('/auth/signup', async (req, res) => {
  try {
    const validatedData = createUserSchema.parse(req.body);

    // Create user in Firebase
    const firebaseUser = await FirebaseService.createUser(validatedData.email, validatedData.password);

    // Sync to local database
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(validatedData.password, 10);
    
    const { db } = await import('../db/config');
    const { users } = await import('../db/schema');
    
    const [localUser] = await db
      .insert(users)
      .values({
        email: validatedData.email,
        fullName: validatedData.email.split('@')[0],
        password: passwordHash,
        role: 'CONSUMER',
        isVerified: firebaseUser.emailVerified,
        createdAt: new Date()
      })
      .returning()
      .onConflictDoNothing();

    // Generate tokens
    const { JWTService } = await import('../services/jwt');
    const tokens = localUser ? JWTService.generateTokenPair(JWTService.createPayloadFromUser(localUser)) : null;

    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        uid: firebaseUser.uid,
        id: localUser?.id,
        email: firebaseUser.email,
        emailVerified: firebaseUser.emailVerified
      },
      tokens
    });
  } catch (error: any) {
    console.error('Firebase create user error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create user'
    });
  }
});

// Firebase token verification endpoint
router.post('/auth/verify-token', async (req, res) => {
  try {
    const { idToken } = z.object({ idToken: z.string() }).parse(req.body);
    
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
      // Create user from Firebase token
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

    // Generate JWT tokens
    const { JWTService } = await import('../services/jwt');
    const tokens = JWTService.generateTokenPair(JWTService.createPayloadFromUser(user));

    // Create session
    (req.session as any).userId = user.id;
    (req.session as any).user = {
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
      user: {
        id: user.id,
        uid: decodedToken.uid,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified
      },
      tokens
    });
  } catch (error: any) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

// Firestore routes
router.post('/firestore/create', requireAuth, async (req, res) => {
  try {
    const validatedData = createDocumentSchema.parse(req.body);

    await FirebaseService.createDocument(
      validatedData.collection,
      validatedData.docId,
      validatedData.data
    );

    res.json({
      success: true,
      message: 'Document created successfully'
    });
  } catch (error: any) {
    console.error('Firestore create error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create document'
    });
  }
});

router.get('/firestore/:collection/:docId', requireAuth, async (req, res) => {
  try {
    const { collection, docId } = req.params;

    const document = await FirebaseService.getDocument(collection, docId);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    res.json({
      success: true,
      data: document
    });
  } catch (error: any) {
    console.error('Firestore get error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to get document'
    });
  }
});

router.put('/firestore/update', requireAuth, async (req, res) => {
  try {
    const validatedData = updateDocumentSchema.parse(req.body);

    await FirebaseService.updateDocument(
      validatedData.collection,
      validatedData.docId,
      validatedData.data
    );

    res.json({
      success: true,
      message: 'Document updated successfully'
    });
  } catch (error: any) {
    console.error('Firestore update error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update document'
    });
  }
});

router.delete('/firestore/:collection/:docId', requireAuth, async (req, res) => {
  try {
    const { collection, docId } = req.params;

    await FirebaseService.deleteDocument(collection, docId);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error: any) {
    console.error('Firestore delete error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to delete document'
    });
  }
});

// Firebase password reset
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    
    const { adminAuth } = await import('../config/firebase-admin');
    if (!adminAuth) {
      return res.status(503).json({
        success: false,
        message: 'Firebase Admin not initialized'
      });
    }

    // Generate password reset link
    const link = await adminAuth.generatePasswordResetLink(email);

    // Send email with reset link (you can use your email service here)
    const EmailService = await import('../services/email');
    await EmailService.default.sendPasswordResetEmail(email, email.split('@')[0], link);

    res.json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error: any) {
    console.error('Password reset error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to send password reset email'
    });
  }
});

export default router;
