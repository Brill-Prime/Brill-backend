import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// For production, use a service account JSON file
// For development, use default credentials or environment variables

let firebaseAdmin: admin.app.App | null = null;
let adminAuth: admin.auth.Auth | null = null;
let adminDb: admin.firestore.Firestore | null = null;
let adminStorage: admin.storage.Storage | null = null;

try {
  // Option 1: Use service account (recommended for production)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      firebaseAdmin = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
      console.log('✅ Firebase Admin SDK initialized with service account');
    } catch (parseError) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON');
    }
  } 
  // Option 2: Use project ID only (limited functionality)
  else if (process.env.FIREBASE_PROJECT_ID) {
    console.warn('⚠️ Firebase Admin initialized with project ID only (limited functionality)');
    console.warn('   For full features, set FIREBASE_SERVICE_ACCOUNT with service account JSON');
    // Don't initialize as it will fail without proper credentials
  } else {
    console.warn('⚠️ Firebase Admin not initialized: Set FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT');
  }

  // Initialize services if app was created successfully
  if (firebaseAdmin) {
    adminAuth = firebaseAdmin.auth();
    adminDb = firebaseAdmin.firestore();
    adminStorage = firebaseAdmin.storage();
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error);
}

// Export Firebase Admin services (will be null if not initialized)
export { adminAuth, adminDb, adminStorage };
export default firebaseAdmin;
