
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// Firebase configuration for Expo/React Native
const firebaseConfig = {
  apiKey: "AIzaSyAqseqstCc-Tx807Hsr_6LXIJbInHY7xUo",
  authDomain: "brillprime.firebaseapp.com",
  projectId: "brillprime",
  storageBucket: "brillprime.firebasestorage.app",
  messagingSenderId: "1064268711919",
  appId: "1:1064268711919:android:6e148568cf68476fa2581a"
};

// Initialize Firebase for mobile
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export default app;
