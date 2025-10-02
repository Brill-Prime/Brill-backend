import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// For production, use a service account JSON file
// For development, use default credentials or environment variables

let firebaseAdmin: admin.app.App;

try {
  // Option 1: Use service account (recommended for production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
  } 
  // Option 2: Use application default credentials (for Replit/Cloud environments)
  else if (process.env.FIREBASE_PROJECT_ID) {
    firebaseAdmin = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
  } else {
    console.warn('⚠️ Firebase Admin not initialized: Set FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT');
    // Initialize with minimal config to prevent crashes
    firebaseAdmin = admin.initializeApp();
  }
  
  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error);
  // Initialize anyway to prevent import errors
  firebaseAdmin = admin.initializeApp();
}

// Export Firebase Admin services
export const adminAuth = firebaseAdmin.auth();
export const adminDb = firebaseAdmin.firestore();
export const adminStorage = firebaseAdmin.storage();

export default firebaseAdmin;
