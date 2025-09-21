// src/services/audit.ts
import { db } from '../db/config';
import { auditLogs } from '../db/schema';

export async function logAdminAction({ userId, action, entityType, entityId, details, ipAddress, userAgent }: {
  userId?: number,
  action: string,
  entityType?: string,
  entityId?: number,
  details?: any,
  ipAddress?: string,
  userAgent?: string
}) {
  await db.insert(auditLogs).values({
    userId,
    action,
    entityType,
    entityId,
    details,
    ipAddress,
    userAgent,
    createdAt: new Date()
  });
}
