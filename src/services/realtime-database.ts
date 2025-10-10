
import { adminRealtimeDb } from '../config/firebase-admin';

/**
 * Writes data to a specific path in the Firebase Realtime Database.
 */
export const writeData = async (path: string, data: any) => {
  if (!adminRealtimeDb) {
    console.warn('Firebase Realtime Database not initialized');
    return;
  }
  const dbRef = adminRealtimeDb.ref(path);
  await dbRef.set(data);
};

/**
 * Reads data from a specific path in the Firebase Realtime Database.
 */
export const readData = async (path: string) => {
  if (!adminRealtimeDb) {
    console.warn('Firebase Realtime Database not initialized');
    return null;
  }
  const dbRef = adminRealtimeDb.ref(path);
  const snapshot = await dbRef.once('value');
  return snapshot.val();
};

/**
 * Updates data at a specific path in the Firebase Realtime Database.
 */
export const updateData = async (path: string, data: any) => {
  if (!adminRealtimeDb) {
    console.warn('Firebase Realtime Database not initialized');
    return;
  }
  const dbRef = adminRealtimeDb.ref(path);
  await dbRef.update(data);
};

/**
 * Deletes data at a specific path in the Firebase Realtime Database.
 */
export const deleteData = async (path: string) => {
  if (!adminRealtimeDb) {
    console.warn('Firebase Realtime Database not initialized');
    return;
  }
  const dbRef = adminRealtimeDb.ref(path);
  await dbRef.remove();
};

export const realtimeDb = {
  ref: (path: string) => {
    if (!adminRealtimeDb) {
      throw new Error('Firebase Realtime Database not initialized');
    }
    return adminRealtimeDb.ref(path);
  },
  writeData,
  readData,
  updateData,
  deleteData
};
