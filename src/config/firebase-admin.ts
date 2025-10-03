
import * as admin from 'firebase-admin';

let firebaseAdmin: admin.app.App | null = null;
let adminAuth: admin.auth.Auth | null = null;
let adminDb: admin.firestore.Firestore | null = null;
let adminStorage: admin.storage.Storage | null = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      firebaseAdmin = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
      console.log('✅ Firebase Admin SDK initialized with service account');
    } catch (parseError) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON');
    }
  } else if (process.env.FIREBASE_PROJECT_ID) {
    console.warn('⚠️ Firebase Admin initialized with project ID only (limited functionality)');
    console.warn('   For full features, set FIREBASE_SERVICE_ACCOUNT with service account JSON');
  } else {
    console.warn('⚠️ Firebase Admin not initialized: Set FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT');
  }

  if (firebaseAdmin) {
    adminAuth = firebaseAdmin.auth();
    adminDb = firebaseAdmin.firestore();
    adminStorage = firebaseAdmin.storage();
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error);
}

export { adminAuth, adminDb, adminStorage };
export default firebaseAdmin;
