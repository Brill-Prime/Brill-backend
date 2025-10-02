import { adminAuth, adminDb, adminStorage } from '../config/firebase-admin';
import { DecodedIdToken } from 'firebase-admin/auth';

export class FirebaseAdminService {
  // ============ Authentication Methods ============
  
  /**
   * Verify Firebase ID token from client
   * Use this to authenticate requests from web/mobile clients
   */
  static async verifyIdToken(token: string): Promise<DecodedIdToken> {
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      return decodedToken;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Create a new user in Firebase Auth
   */
  static async createUser(email: string, password: string, displayName?: string) {
    try {
      const userRecord = await adminAuth.createUser({
        email,
        password,
        displayName,
        emailVerified: false
      });
      return userRecord;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user by UID
   */
  static async getUserByUid(uid: string) {
    try {
      const userRecord = await adminAuth.getUser(uid);
      return userRecord;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update user in Firebase Auth
   */
  static async updateUser(uid: string, updates: any) {
    try {
      const userRecord = await adminAuth.updateUser(uid, updates);
      return userRecord;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete user from Firebase Auth
   */
  static async deleteUser(uid: string) {
    try {
      await adminAuth.deleteUser(uid);
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate custom token for user
   */
  static async createCustomToken(uid: string, claims?: object) {
    try {
      const customToken = await adminAuth.createCustomToken(uid, claims);
      return customToken;
    } catch (error) {
      throw error;
    }
  }

  // ============ Firestore Methods ============

  /**
   * Create or set a document in Firestore
   */
  static async setDocument(collection: string, docId: string, data: any) {
    try {
      await adminDb.collection(collection).doc(docId).set({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get a document from Firestore
   */
  static async getDocument(collection: string, docId: string) {
    try {
      const doc = await adminDb.collection(collection).doc(docId).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
      return null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update a document in Firestore
   */
  static async updateDocument(collection: string, docId: string, data: any) {
    try {
      await adminDb.collection(collection).doc(docId).update({
        ...data,
        updatedAt: new Date()
      });
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete a document from Firestore
   */
  static async deleteDocument(collection: string, docId: string) {
    try {
      await adminDb.collection(collection).doc(docId).delete();
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Query documents from Firestore
   */
  static async queryDocuments(collection: string, filters: { field: string; operator: FirebaseFirestore.WhereFilterOp; value: any }[]) {
    try {
      let query: FirebaseFirestore.Query = adminDb.collection(collection);
      
      filters.forEach(filter => {
        query = query.where(filter.field, filter.operator, filter.value);
      });

      const snapshot = await query.get();
      const documents: any[] = [];
      
      snapshot.forEach(doc => {
        documents.push({ id: doc.id, ...doc.data() });
      });

      return documents;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all documents from a collection
   */
  static async getAllDocuments(collection: string) {
    try {
      const snapshot = await adminDb.collection(collection).get();
      const documents: any[] = [];
      
      snapshot.forEach(doc => {
        documents.push({ id: doc.id, ...doc.data() });
      });

      return documents;
    } catch (error) {
      throw error;
    }
  }

  // ============ Storage Methods ============

  /**
   * Upload file to Firebase Storage
   */
  static async uploadFile(buffer: Buffer, destination: string, metadata?: any) {
    try {
      const bucket = adminStorage.bucket();
      const file = bucket.file(destination);
      
      await file.save(buffer, {
        metadata: metadata || {},
        contentType: metadata?.contentType || 'application/octet-stream'
      });

      // Make file publicly accessible (optional)
      // await file.makePublic();

      // Get download URL
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500' // Far future date
      });

      return url;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete file from Firebase Storage
   */
  static async deleteFile(filePath: string) {
    try {
      const bucket = adminStorage.bucket();
      await bucket.file(filePath).delete();
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get file download URL
   */
  static async getFileUrl(filePath: string) {
    try {
      const bucket = adminStorage.bucket();
      const file = bucket.file(filePath);
      
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500'
      });

      return url;
    } catch (error) {
      throw error;
    }
  }
}

export default FirebaseAdminService;
