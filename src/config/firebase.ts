
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

// Firebase configuration - all values should be set as secrets in Replit
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Check if Firebase is configured
const isFirebaseConfigured = firebaseConfig.apiKey && firebaseConfig.projectId;

let app: any = null;
let auth: any = null;
let db: any = null;
let storage: any = null;
let messaging: any = null;

if (isFirebaseConfigured) {
  try {
    // Initialize Firebase
    app = initializeApp(firebaseConfig);

    // Initialize Firebase services
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);

    // Initialize messaging for mobile push notifications (web only)
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined') {
      isSupported().then(supported => {
        if (supported) {
          messaging = getMessaging(app);
        }
      });
    }

    console.log('✅ Firebase client SDK initialized');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
  }
} else {
  console.warn('⚠️ Firebase client SDK not configured. Set FIREBASE_API_KEY and FIREBASE_PROJECT_ID to enable.');
  console.warn('   For backend operations, use Firebase Admin SDK from src/config/firebase-admin.ts');
}

export { auth, db, storage, messaging };
export default app;
