
import { getDatabase, ref, runTransaction } from "firebase/database";
import app from "../config/firebase";

const db = getDatabase(app);

/**
 * Ensures that a function is executed only once for a given idempotency key.
 *
 * @param idempotencyKey A unique key for the operation.
 * @param operation The function to execute.
 * @returns A promise that resolves with the result of the operation, or rejects if the operation has already been performed.
 */
export const withIdempotency = async (idempotencyKey: string, operation: () => Promise<any>) => {
  const idempotencyRef = ref(db, `idempotencyKeys/${idempotencyKey}`);

  return runTransaction(idempotencyRef, (currentData) => {
    if (currentData === null) {
      return { status: "pending", createdAt: new Date().toISOString() };
    } else if (currentData.status === "completed") {
      // The operation has already been completed, so we can just return its result.
      return;
    } else {
      // The operation is still pending, so we should not try to execute it again.
      return;
    }
  }).then(async (result) => {
    if (result.committed && result.snapshot.val().status === "pending") {
      try {
        const operationResult = await operation();
        await runTransaction(idempotencyRef, (currentData) => {
            return { ...currentData, status: "completed", result: operationResult };
        });
        return operationResult;
      } catch (error) {
        await runTransaction(idempotencyRef, (currentData) => {
            return { ...currentData, status: "failed", error: error.message };
        });
        throw error;
      }
    } else {
      throw new Error("The operation has already been performed.");
    }
  });
};
