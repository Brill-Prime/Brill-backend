
import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db/config';
import { users, mfaTokens, auditLogs } from '../db/schema';
import { eq, and, isNull, or, ilike, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireOwnershipOrAdmin, hashPassword } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  role: z.enum(['CONSUMER', 'DRIVER', 'MERCHANT', 'ADMIN']).default('CONSUMER')
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  profilePicture: z.string().url().optional(),
  role: z.enum(['CONSUMER', 'DRIVER', 'MERCHANT', 'ADMIN']).optional()
});

const querySchema = z.object({
  page: z.string().optional().transform(val => val ? parseInt(val) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val) : 10),
  search: z.string().optional(),
  role: z.enum(['CONSUMER', 'DRIVER', 'MERCHANT', 'ADMIN']).optional(),
  isVerified: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
  isActive: z.string().optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined)
});

// POST /api/users - Register a new user (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userData = createUserSchema.parse(req.body);

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, userData.email))
      .limit(1);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(userData.password);

    // Create user
    const newUsers = await db
      .insert(users)
      .values({
        email: userData.email,
        fullName: userData.fullName,
        phone: userData.phone,
        role: userData.role,
        password: passwordHash,
        createdAt: new Date()
      })
      .returning();

    const newUser = newUsers[0];

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: newUser.id,
      details: { createdUserId: newUser.id, role: newUser.role },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        phone: newUser.phone,
        role: newUser.role,
        isVerified: newUser.isVerified,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt
      }
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
});

// GET /api/users - List all users (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = querySchema.parse(req.query);
    const { page, limit, search, role, isVerified, isActive } = query;

    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [isNull(users.deletedAt)];
    
    if (search) {
      conditions.push(
        or(
          ilike(users.fullName, `%${search}%`),
          ilike(users.email, `%${search}%`)
        )!
      );
    }

    if (role) {
      conditions.push(eq(users.role, role));
    }

    if (isVerified !== undefined) {
      conditions.push(eq(users.isVerified, isVerified));
    }

    if (isActive !== undefined) {
      conditions.push(eq(users.isActive, isActive));
    }

    // Get users with pagination
    const usersList = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        role: users.role,
        isVerified: users.isVerified,
        isActive: users.isActive,
        averageRating: users.averageRating,
        totalRatings: users.totalRatings,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt
      })
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: users.id })
      .from(users)
      .where(and(...conditions));

    res.json({
      success: true,
      data: usersList,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error: any) {
    console.error('List users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// GET /api/users/:id - Get user details
router.get('/:id', requireAuth, requireOwnershipOrAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        profilePicture: users.profilePicture,
        role: users.role,
        isVerified: users.isVerified,
        isActive: users.isActive,
        mfaEnabled: users.mfaEnabled,
        averageRating: users.averageRating,
        totalRatings: users.totalRatings,
        lastLoginAt: users.lastLoginAt,
        loginAttempts: users.loginAttempts,
        accountLockedUntil: users.accountLockedUntil,
        paystackRecipientCode: users.paystackRecipientCode,
        bankName: users.bankName,
        accountNumber: users.accountNumber,
        accountName: users.accountName,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
});

// PUT /api/users/:id - Update user details
router.put('/:id', requireAuth, requireOwnershipOrAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const updateData = updateUserSchema.parse(req.body);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email is being changed and if it's already taken
    if (updateData.email && updateData.email !== existingUser.email) {
      const [emailTaken] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, updateData.email), isNull(users.deletedAt)))
        .limit(1);

      if (emailTaken) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
    }

    // Only admins can change roles
    if (updateData.role && req.session.user?.role !== 'ADMIN') {
      delete updateData.role;
    }

    // Update user
    const [updatedUser] = await db
      .update(users)
      .set({
        ...updateData,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        profilePicture: users.profilePicture,
        role: users.role,
        isVerified: users.isVerified,
        isActive: users.isActive,
        updatedAt: users.updatedAt
      });

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: userId,
      details: updateData,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Update session if user updated their own profile
    if (req.session.user?.id === userId) {
      req.session.user = {
        ...req.session.user,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        role: updatedUser.role || req.session.user.role,
        profilePicture: updatedUser.profilePicture || undefined
      };
    }

    res.json({
      success: true,
      user: updatedUser
    });
  } catch (error: any) {
    console.error('Update user error:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

// DELETE /api/users/:id - Soft delete a user
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Prevent self-deletion
    if (req.session.user?.id === userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    // Check if user exists and is not already deleted
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete user
    await db
      .update(users)
      .set({
        deletedAt: new Date(),
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'USER_DELETED',
      entityType: 'USER',
      entityId: userId,
      details: { deletedUserId: userId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

// POST /api/users/:id/verify - Verify a user
router.post('/:id/verify', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update verification status
    const [updatedUser] = await db
      .update(users)
      .set({
        isVerified: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        isVerified: users.isVerified
      });

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'USER_VERIFIED',
      entityType: 'USER',
      entityId: userId,
      details: { verifiedUserId: userId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User verified successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Verify user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify user'
    });
  }
});

// POST /api/users/:id/lock - Lock a user account
router.post('/:id/lock', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Prevent self-locking
    if (req.session.user?.id === userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot lock your own account'
      });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Lock account for 24 hours
    const lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db
      .update(users)
      .set({
        accountLockedUntil: lockUntil,
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'USER_LOCKED',
      entityType: 'USER',
      entityId: userId,
      details: { lockedUserId: userId, lockUntil },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User account locked successfully'
    });
  } catch (error) {
    console.error('Lock user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lock user account'
    });
  }
});

// POST /api/users/:id/unlock - Unlock a user account
router.post('/:id/unlock', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Unlock account
    await db
      .update(users)
      .set({
        accountLockedUntil: null,
        loginAttempts: 0,
        isActive: true,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'USER_UNLOCKED',
      entityType: 'USER',
      entityId: userId,
      details: { unlockedUserId: userId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'User account unlocked successfully'
    });
  } catch (error) {
    console.error('Unlock user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlock user account'
    });
  }
});

// POST /api/users/:id/mfa/enable - Enable MFA for a user
router.post('/:id/mfa/enable', requireAuth, requireOwnershipOrAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { method = 'EMAIL' } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (existingUser.mfaEnabled) {
      return res.status(400).json({
        success: false,
        message: 'MFA is already enabled for this user'
      });
    }

    // Generate MFA secret (for TOTP if needed)
    const mfaSecret = crypto.randomBytes(32).toString('hex');

    // Enable MFA
    await db
      .update(users)
      .set({
        mfaEnabled: true,
        mfaMethod: method,
        mfaSecret: mfaSecret,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'MFA_ENABLED',
      entityType: 'USER',
      entityId: userId,
      details: { enabledForUserId: userId, method },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'MFA enabled successfully',
      mfaMethod: method
    });
  } catch (error) {
    console.error('Enable MFA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enable MFA'
    });
  }
});

// POST /api/users/:id/mfa/disable - Disable MFA for a user
router.post('/:id/mfa/disable', requireAuth, requireOwnershipOrAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!existingUser.mfaEnabled) {
      return res.status(400).json({
        success: false,
        message: 'MFA is not enabled for this user'
      });
    }

    // Disable MFA
    await db
      .update(users)
      .set({
        mfaEnabled: false,
        mfaMethod: null,
        mfaSecret: null,
        mfaBackupCodes: '[]',
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    // Log audit trail
    await db.insert(auditLogs).values({
      userId: req.session.user?.id,
      action: 'MFA_DISABLED',
      entityType: 'USER',
      entityId: userId,
      details: { disabledForUserId: userId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'MFA disabled successfully'
    });
  } catch (error) {
    console.error('Disable MFA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable MFA'
    });
  }
});

export default router;
