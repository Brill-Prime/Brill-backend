
import express from 'express';
import { db } from '../db/config';
import { users, auditLogs } from '../db/schema';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  profilePicture: z.string().url().optional(),
  bio: z.string().max(500).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional()
});

// GET /api/profile - Get current user profile
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        profilePicture: users.profilePicture,
        role: users.role,
        isVerified: users.isVerified,
        averageRating: users.averageRating,
        totalRatings: users.totalRatings,
        metadata: users.metadata,
        createdAt: users.createdAt
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

// PUT /api/profile - Update user profile
router.put('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = updateProfileSchema.parse(req.body);

    const [updatedUser] = await db
      .update(users)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    // Log audit event
    await db.insert(auditLogs).values({
      userId,
      action: 'PROFILE_UPDATED',
      entityType: 'USER',
      entityId: userId,
      details: validatedData
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update profile error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// DELETE /api/profile - Delete user account
router.delete('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    await db
      .update(users)
      .set({
        deletedAt: new Date(),
        isActive: false
      })
      .where(eq(users.id, userId));

    // Log audit event
    await db.insert(auditLogs).values({
      userId,
      action: 'ACCOUNT_DELETED',
      entityType: 'USER',
      entityId: userId,
      details: {}
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

export default router;
