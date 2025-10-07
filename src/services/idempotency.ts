
import { adminRealtimeDb } from "../config/firebase-admin";

const db = adminRealtimeDb;

/**
 * Ensures that a function is executed only once for a given idempotency key.
 *
 * @param idempotencyKey A unique key for the operation.
 * @param operation The function to execute.
 * @returns A promise that resolves with the result of the operation, or rejects if the operation has already been performed.
 */
export const withIdempotency = async (idempotencyKey: string, operation: () => Promise<any>) => {
  const idempotencyRef = db.ref(`idempotencyKeys/${idempotencyKey}`);

  return idempotencyRef.transaction((currentData) => {
    if (currentData === null) {
      return { status: "pending", createdAt: new Date().toISOString() };
    } else if (currentData.status === "completed") {
      return; // Already completed
    } else {
      return; // Still pending
    }
  }).then(async (result) => {
    if (result.committed && result.snapshot.val().status === "pending") {
      try {
        const operationResult = await operation();
        await idempotencyRef.transaction((currentData) => ({ ...currentData, status: "completed", result: operationResult }));
        return operationResult;
      } catch (error: any) {
        await idempotencyRef.transaction((currentData) => ({ ...currentData, status: "failed", error: error.message }));
        throw error;
      }
    } else {
      throw new Error("The operation has already been performed.");
    }
  });
};
