// src/services/otp.ts
import { db } from '../db/config';
import { mfaTokens, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export async function createOTP(userId: number, method: string, expiresInMinutes = 10): Promise<string> {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000);
  await db.insert(mfaTokens).values({
    userId,
    token: otp,
    method,
    expiresAt,
  });
  return otp;
}

export async function validateOTP(userId: number, otp: string, method: string): Promise<boolean> {
  const [token] = await db.select().from(mfaTokens)
    .where(and(eq(mfaTokens.userId, userId), eq(mfaTokens.token, otp), eq(mfaTokens.method, method), eq(mfaTokens.isUsed, false)))
    .limit(1);
  if (!token || new Date(token.expiresAt) < new Date()) return false;
  await db.update(mfaTokens).set({ isUsed: true, usedAt: new Date() }).where(eq(mfaTokens.id, token.id));
  return true;
}
