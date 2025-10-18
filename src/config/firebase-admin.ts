
import * as admin from 'firebase-admin';
import { getDatabase } from 'firebase-admin/database';

let adminApp: admin.app.App | null = null;
let adminAuth: admin.auth.Auth | null = null;
let adminDb: admin.firestore.Firestore | null = null;
let adminStorage: admin.storage.Storage | null = null;
let adminRealtimeDb: admin.database.Database | null = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'brillprimefirebase',
        databaseURL: 'https://brillprimefirebase-default-rtdb.firebaseio.com',
        storageBucket: 'brillprimefirebase.firebasestorage.app'
      });
      console.log('✅ Firebase Admin SDK initialized with service account');

    } catch (parseError) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON');
      console.warn('   For full features, set FIREBASE_SERVICE_ACCOUNT with service account JSON');
    }
  } else if (process.env.FIREBASE_PROJECT_ID) {
    console.warn('⚠️ Firebase Admin initialized with project ID only (limited functionality)');
    console.warn('   For full features, set FIREBASE_SERVICE_ACCOUNT with service account JSON');
  } else {
    console.warn('⚠️ Firebase Admin not initialized: Set FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT');
  }

  if (adminApp) {
    adminAuth = adminApp.auth();
    adminDb = adminApp.firestore();
    adminStorage = adminApp.storage();
    adminRealtimeDb = getDatabase(adminApp);
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error);
}

export { adminApp, adminAuth, adminDb, adminStorage, adminRealtimeDb };

