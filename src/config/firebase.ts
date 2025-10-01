
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDWy-NucthigIrHSNYo_nI-o2BY8Rwkod0",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "brillprime.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "brillprime",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "brillprime.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1064268711919",
  appId: process.env.FIREBASE_APP_ID || "1:1064268711919:web:de8f36a25600d553a2581a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialize messaging for mobile push notifications (web only)
let messaging: any = null;
if (typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined') {
  isSupported().then(supported => {
    if (supported) {
      messaging = getMessaging(app);
    }
  });
}

export { messaging };
export default app;
