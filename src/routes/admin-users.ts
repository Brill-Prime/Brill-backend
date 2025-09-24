
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { adminUsers, users } from '../db/schema';
import { eq, and, desc, ilike, or, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const adminUsersQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  department: z.string().optional(),
  isActive: z.string().optional(),
  search: z.string().optional()
});

const createAdminUserSchema = z.object({
  userId: z.number(),
  permissions: z.array(z.string()).default([]),
  department: z.string().optional(),
  isActive: z.boolean().default(true)
});

const updateAdminUserSchema = z.object({
  permissions: z.array(z.string()).optional(),
  department: z.string().optional(),
  isActive: z.boolean().optional()
});

// POST /api/admin-users - Create a new admin user
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const adminData = createAdminUserSchema.parse(req.body);

    // Check if user exists and is not already an admin
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, adminData.userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is already an admin
    const [existingAdmin] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.userId, adminData.userId))
      .limit(1);

    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'User is already an admin'
      });
    }

    // Update user role to ADMIN
    await db
      .update(users)
      .set({ 
        role: 'ADMIN',
        updatedAt: new Date()
      })
      .where(eq(users.id, adminData.userId));

    // Create admin user record
    const [newAdminUser] = await db
      .insert(adminUsers)
      .values({
        ...adminData,
        createdAt: new Date()
      })
      .returning();

    // Get the complete admin user data with user details
    const [adminUserWithDetails] = await db
      .select({
        id: adminUsers.id,
        userId: adminUsers.userId,
        permissions: adminUsers.permissions,
        department: adminUsers.department,
        isActive: adminUsers.isActive,
        lastActiveAt: adminUsers.lastActiveAt,
        createdAt: adminUsers.createdAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          isVerified: users.isVerified
        }
      })
      .from(adminUsers)
      .innerJoin(users, eq(adminUsers.userId, users.id))
      .where(eq(adminUsers.id, newAdminUser.id))
      .limit(1);

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: adminUserWithDetails
    });
  } catch (error) {
    console.error('Create admin user error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create admin user'
    });
  }
});

// GET /api/admin-users - List all admin users (Super Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = adminUsersQuerySchema.parse(req.query);
    const page = parseInt(query.page);
    const limit = Math.min(parseInt(query.limit), 100);
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];

    if (query.department) {
      conditions.push(ilike(adminUsers.department, `%${query.department}%`));
    }

    if (query.isActive !== undefined) {
      const isActive = query.isActive === 'true';
      conditions.push(eq(adminUsers.isActive, isActive));
    }

    if (query.search) {
      conditions.push(
        or(
          ilike(users.fullName, `%${query.search}%`),
          ilike(users.email, `%${query.search}%`),
          ilike(adminUsers.department, `%${query.search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get admin users with user details
    const adminUsersList = await db
      .select({
        id: adminUsers.id,
        userId: adminUsers.userId,
        permissions: adminUsers.permissions,
        department: adminUsers.department,
        isActive: adminUsers.isActive,
        lastActiveAt: adminUsers.lastActiveAt,
        createdAt: adminUsers.createdAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          isVerified: users.isVerified,
          profilePicture: users.profilePicture,
          lastLoginAt: users.lastLoginAt
        }
      })
      .from(adminUsers)
      .innerJoin(users, eq(adminUsers.userId, users.id))
      .where(whereClause)
      .orderBy(desc(adminUsers.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(adminUsers)
      .innerJoin(users, eq(adminUsers.userId, users.id))
      .where(whereClause);

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      data: adminUsersList,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Get admin users error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin users'
    });
  }
});

// PUT /api/admin-users/:id - Update admin user details
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const adminUserId = parseInt(req.params.id);
    const updateData = updateAdminUserSchema.parse(req.body);

    // Check if admin user exists
    const [existingAdminUser] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, adminUserId))
      .limit(1);

    if (!existingAdminUser) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    // Update admin user
    const [updatedAdminUser] = await db
      .update(adminUsers)
      .set({
        ...updateData,
        lastActiveAt: new Date()
      })
      .where(eq(adminUsers.id, adminUserId))
      .returning();

    // Get the complete updated admin user data with user details
    const [adminUserWithDetails] = await db
      .select({
        id: adminUsers.id,
        userId: adminUsers.userId,
        permissions: adminUsers.permissions,
        department: adminUsers.department,
        isActive: adminUsers.isActive,
        lastActiveAt: adminUsers.lastActiveAt,
        createdAt: adminUsers.createdAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          isVerified: users.isVerified,
          profilePicture: users.profilePicture
        }
      })
      .from(adminUsers)
      .innerJoin(users, eq(adminUsers.userId, users.id))
      .where(eq(adminUsers.id, adminUserId))
      .limit(1);

    res.json({
      success: true,
      message: 'Admin user updated successfully',
      data: adminUserWithDetails
    });
  } catch (error) {
    console.error('Update admin user error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update admin user'
    });
  }
});

export default router;
