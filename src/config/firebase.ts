
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
    apiKey: "AIzaSyBAe9x-nOCzn8VA1oAP23y2Sv2sIiVyP0s",
    authDomain: "brillprimefirebase.firebaseapp.com",
    databaseURL: "https://brillprimefirebase-default-rtdb.firebaseio.com",
    projectId: "brillprimefirebase",
    storageBucket: "brillprimefirebase.firebasestorage.app",
    messagingSenderId: "655201684400",
    appId: "1:655201684400:web:ec3ac485a4f98a82fb2475",
    measurementId: "G-7T5QKZPDWW"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const analytics = getAnalytics(app);

export { app, auth, db, storage, analytics };
