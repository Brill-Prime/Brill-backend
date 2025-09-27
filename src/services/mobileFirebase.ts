
import { FirebaseService } from './firebase';
import { auth, db } from '../config/firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  serverTimestamp,
  enableNetwork,
  disableNetwork
} from 'firebase/firestore';

export class MobileFirebaseService extends FirebaseService {
  // Mobile-specific authentication with offline support
  static async enableOfflineSupport() {
    try {
      // Enable offline persistence for mobile apps
      await enableNetwork(db);
      return true;
    } catch (error) {
      console.error('Error enabling offline support:', error);
      return false;
    }
  }

  static async disableOfflineSupport() {
    try {
      await disableNetwork(db);
      return true;
    } catch (error) {
      console.error('Error disabling offline support:', error);
      return false;
    }
  }

  // Real-time listeners for mobile apps
  static subscribeToDocument(
    collectionName: string, 
    docId: string, 
    callback: (data: any) => void
  ) {
    const docRef = doc(db, collectionName, docId);
    return onSnapshot(docRef, (doc) => {
      if (doc.exists()) {
        callback({ id: doc.id, ...doc.data() });
      } else {
        callback(null);
      }
    });
  }

  static subscribeToCollection(
    collectionName: string, 
    callback: (data: any[]) => void
  ) {
    const collectionRef = collection(db, collectionName);
    return onSnapshot(collectionRef, (snapshot) => {
      const documents: any[] = [];
      snapshot.forEach((doc) => {
        documents.push({ id: doc.id, ...doc.data() });
      });
      callback(documents);
    });
  }

  // Mobile-optimized document creation with server timestamp
  static async createMobileDocument(collectionName: string, docId: string, data: any) {
    try {
      const mobileData = {
        ...data,
        createdAt: serverTimestamp(),
        platform: 'mobile',
        deviceInfo: {
          timestamp: new Date(),
          version: '1.0.0'
        }
      };
      
      return await this.createDocument(collectionName, docId, mobileData);
    } catch (error) {
      throw error;
    }
  }

  // User presence for mobile apps
  static async setUserPresence(userId: string, isOnline: boolean) {
    try {
      const presenceData = {
        isOnline,
        lastSeen: serverTimestamp(),
        platform: 'mobile'
      };
      
      await this.updateDocument('userPresence', userId, presenceData);
      return true;
    } catch (error) {
      throw error;
    }
  }

  // Mobile-specific error handling
  static handleMobileError(error: any) {
    if (error.code === 'unavailable') {
      return {
        type: 'OFFLINE',
        message: 'Device is offline. Changes will sync when connection is restored.',
        canRetry: true
      };
    }
    
    if (error.code === 'permission-denied') {
      return {
        type: 'PERMISSION',
        message: 'Permission denied. Please check authentication.',
        canRetry: false
      };
    }
    
    return {
      type: 'UNKNOWN',
      message: error.message || 'An unknown error occurred',
      canRetry: true
    };
  }
}
