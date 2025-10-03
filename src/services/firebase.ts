
import { adminAuth, adminDb, adminStorage } from '../config/firebase-admin';

// Note: The Firebase Admin SDK is used on the server side. 
// It has different methods than the client-side SDK.
// For example, user sign-in is a client-side operation. 
// The server verifies ID tokens, but does not sign users in with passwords.

export class FirebaseService {

  // =================================================================
  // Authentication (Admin SDK)
  // =================================================================

  /**
   * Creates a new user in Firebase Authentication.
   * @param email The user's email.
   * @param password The user's password.
   * @returns The created user record.
   */
  static async createUser(email: string, password: string) {
    if (!adminAuth) throw new Error('Firebase Admin Auth not initialized');
    try {
      const userRecord = await adminAuth.createUser({ email, password });
      return userRecord;
    } catch (error) {
      console.error("Error creating Firebase user:", error);
      throw error;
    }
  }

  /**
   * Fetches a user record by email.
   * @param email The user's email.
   * @returns The user record.
   */
  static async getUserByEmail(email: string) {
    if (!adminAuth) throw new Error('Firebase Admin Auth not initialized');
    try {
      const userRecord = await adminAuth.getUserByEmail(email);
      return userRecord;
    } catch (error) {
      console.error("Error fetching user by email:", error);
      throw error;
    }
  }

  // =================================================================
  // Firestore (Admin SDK)
  // =================================================================

  static async createDocument(collectionName: string, docId: string, data: any) {
    if (!adminDb) throw new Error('Firebase Admin Firestore not initialized');
    try {
      await adminDb.collection(collectionName).doc(docId).set(data);
      return true;
    } catch (error) {
      console.error("Error creating Firestore document:", error);
      throw error;
    }
  }

  static async getDocument(collectionName: string, docId: string) {
    if (!adminDb) throw new Error('Firebase Admin Firestore not initialized');
    try {
      const docRef = adminDb.collection(collectionName).doc(docId);
      const docSnap = await docRef.get();
      
      if (docSnap.exists) {
        return { id: docSnap.id, ...docSnap.data() };
      } else {
        return null;
      }
    } catch (error) {
      console.error("Error getting Firestore document:", error);
      throw error;
    }
  }

  static async updateDocument(collectionName: string, docId: string, data: any) {
    if (!adminDb) throw new Error('Firebase Admin Firestore not initialized');
    try {
      const docRef = adminDb.collection(collectionName).doc(docId);
      await docRef.update(data);
      return true;
    } catch (error) {
      console.error("Error updating Firestore document:", error);
      throw error;
    }
  }

  static async deleteDocument(collectionName: string, docId: string) {
    if (!adminDb) throw new Error('Firebase Admin Firestore not initialized');
    try {
      await adminDb.collection(collectionName).doc(docId).delete();
      return true;
    } catch (error) {
      console.error("Error deleting Firestore document:", error);
      throw error;
    }
  }

  static async queryDocuments(collectionName: string, field: string, operator: FirebaseFirestore.WhereFilterOp, value: any) {
    if (!adminDb) throw new Error('Firebase Admin Firestore not initialized');
    try {
      const q = adminDb.collection(collectionName).where(field, operator, value);
      const querySnapshot = await q.get();
      
      const documents: any[] = [];
      querySnapshot.forEach((doc) => {
        documents.push({ id: doc.id, ...doc.data() });
      });
      
      return documents;
    } catch (error) {
      console.error("Error querying Firestore documents:", error);
      throw error;
    }
  }

  // =================================================================
  // Cloud Storage (Admin SDK)
  // =================================================================

  static async uploadFile(file: Buffer, fileName: string, folder: string = 'uploads') {
    if (!adminStorage) throw new Error('Firebase Admin Storage not initialized');
    try {
      const bucket = adminStorage.bucket();
      const filePath = `${folder}/${fileName}`;
      const fileUpload = bucket.file(filePath);

      await fileUpload.save(file);
      
      // Make the file public and return the URL
      await fileUpload.makePublic();
      return fileUpload.publicUrl();

    } catch (error) {
      console.error("Error uploading file to Storage:", error);
      throw error;
    }
  }

  static async deleteFile(filePath: string) {
    if (!adminStorage) throw new Error('Firebase Admin Storage not initialized');
    try {
      const bucket = adminStorage.bucket();
      await bucket.file(filePath).delete();
      return true;
    } catch (error) {
      console.error("Error deleting file from Storage:", error);
      // Check if the error is that the file doesn't exist, which is not a failure
      if ((error as any).code === 404) {
        console.warn(`File not found, could not delete: ${filePath}`);
        return true; 
      }
      throw error;
    }
  }
}
