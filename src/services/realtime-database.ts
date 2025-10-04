
import { ref, set } from 'firebase/database';
import { adminDb } from '../config/firebase-admin';

/**
 * Writes data to a specific path in the Firebase Realtime Database.
 *
 * @param path The path to the data.
 * @param data The data to write.
 * @returns A promise that resolves when the write is complete.
 */
export const writeData = async (path: string, data: any) => {
  const dbRef = ref(adminDb, path);
  await set(dbRef, data);
};
