
import { db } from '../db/config';

export async function withTransaction<T>(
  // use a permissive tx type because the runtime transaction object
  // may differ between drivers. Narrowing here causes many typing errors
  // across the codebase; keep it `any` to unblock compilation and
  // allow incremental typing improvements later.
  callback: (tx: any) => Promise<T>
): Promise<T> {
  try {
    const result = await db.transaction(async (tx) => {
      return await callback(tx as any);
    });
    return result;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
}

export default withTransaction;
