
import { db } from '../db/config';

export async function withTransaction<T>(
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  try {
    const result = await db.transaction(async (tx) => {
      return await callback(tx);
    });
    return result;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
}

export default withTransaction;
