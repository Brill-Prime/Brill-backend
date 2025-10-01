
import express from 'express';
import { z } from 'zod';
import { FirebaseService } from '../services/firebase';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const signInSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

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
router.post('/auth/signin', async (req, res) => {
  try {
    const validatedData = signInSchema.parse(req.body);
    
    const user = await FirebaseService.signInUser(validatedData.email, validatedData.password);
    
    res.json({
      success: true,
      message: 'User signed in successfully',
      user: {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified
      }
    });
  } catch (error: any) {
    console.error('Firebase sign in error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to sign in user'
    });
  }
});

router.post('/auth/signup', async (req, res) => {
  try {
    const validatedData = createUserSchema.parse(req.body);
    
    const user = await FirebaseService.createUser(validatedData.email, validatedData.password);
    
    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified
      }
    });
  } catch (error: any) {
    console.error('Firebase create user error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create user'
    });
  }
});

router.post('/auth/signout', async (req, res) => {
  try {
    await FirebaseService.signOutUser();
    
    res.json({
      success: true,
      message: 'User signed out successfully'
    });
  } catch (error: any) {
    console.error('Firebase sign out error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to sign out user'
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

export default router;
