
import { auth, db, storage } from '../config/firebase';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';

export class WebFirebaseService {
  // Authentication methods
  static async signIn(email: string, password: string): Promise<User> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  }

  static async signUp(email: string, password: string): Promise<User> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      throw error;
    }
  }

  static async signOut(): Promise<void> {
    try {
      await signOut(auth);
    } catch (error) {
      throw error;
    }
  }

  static async resetPassword(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      throw error;
    }
  }

  static async updateUserProfile(user: User, profile: { displayName?: string; photoURL?: string }): Promise<void> {
    try {
      await updateProfile(user, profile);
    } catch (error) {
      throw error;
    }
  }

  static getCurrentUser(): User | null {
    return auth.currentUser;
  }

  static onAuthStateChanged(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
  }

  // Firestore methods
  static async createDocument(collectionName: string, docId: string, data: any) {
    try {
      const docRef = doc(db, collectionName, docId);
      await setDoc(docRef, {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return docRef;
    } catch (error) {
      throw error;
    }
  }

  static async getDocument(collectionName: string, docId: string) {
    try {
      const docRef = doc(db, collectionName, docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
      } else {
        return null;
      }
    } catch (error) {
      throw error;
    }
  }

  static async updateDocument(collectionName: string, docId: string, data: any) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        ...data,
        updatedAt: new Date()
      });
      return docRef;
    } catch (error) {
      throw error;
    }
  }

  static async deleteDocument(collectionName: string, docId: string) {
    try {
      const docRef = doc(db, collectionName, docId);
      await deleteDoc(docRef);
      return true;
    } catch (error) {
      throw error;
    }
  }

  // Query methods
  static async getCollection(collectionName: string, queryOptions?: any) {
    try {
      const collectionRef = collection(db, collectionName);
      let q = query(collectionRef);

      if (queryOptions?.where) {
        q = query(q, where(queryOptions.where.field, queryOptions.where.operator, queryOptions.where.value));
      }

      if (queryOptions?.orderBy) {
        q = query(q, orderBy(queryOptions.orderBy.field, queryOptions.orderBy.direction || 'asc'));
      }

      if (queryOptions?.limit) {
        q = query(q, limit(queryOptions.limit));
      }

      const querySnapshot = await getDocs(q);
      const documents: any[] = [];
      
      querySnapshot.forEach((doc) => {
        documents.push({ id: doc.id, ...doc.data() });
      });

      return documents;
    } catch (error) {
      throw error;
    }
  }

  // Real-time listeners
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
    callback: (data: any[]) => void,
    queryOptions?: any
  ) {
    const collectionRef = collection(db, collectionName);
    let q = query(collectionRef);

    if (queryOptions?.where) {
      q = query(q, where(queryOptions.where.field, queryOptions.where.operator, queryOptions.where.value));
    }

    if (queryOptions?.orderBy) {
      q = query(q, orderBy(queryOptions.orderBy.field, queryOptions.orderBy.direction || 'asc'));
    }

    return onSnapshot(q, (querySnapshot) => {
      const documents: any[] = [];
      querySnapshot.forEach((doc) => {
        documents.push({ id: doc.id, ...doc.data() });
      });
      callback(documents);
    });
  }

  // Storage methods
  static async uploadFile(file: File, fileName: string, folder: string = 'uploads') {
    try {
      const storageRef = ref(storage, `${folder}/${fileName}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      return downloadURL;
    } catch (error) {
      throw error;
    }
  }

  static async deleteFile(filePath: string) {
    try {
      const fileRef = ref(storage, filePath);
      await deleteObject(fileRef);
      return true;
    } catch (error) {
      throw error;
    }
  }

  // Backend sync methods
  static async syncWithBackend(endpoint: string, data: any, method: string = 'POST') {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      const token = await user.getIdToken();
      
      const response = await fetch(`${process.env.API_BASE_URL || 'https://your-repl-name.replit.app'}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`Backend sync failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }
}
