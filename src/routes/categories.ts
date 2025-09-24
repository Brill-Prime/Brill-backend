
import express from 'express';
import { db } from '../db/config';
import { categories, auditLogs } from '../db/schema';
import { eq, isNull, ilike, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true)
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().optional()
});

// Helper function to log audit events
const logAuditEvent = async (userId: number, action: string, entityId: number, details: any = {}) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType: 'CATEGORY',
      entityId,
      details,
      ipAddress: '',
      userAgent: ''
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

// POST /api/categories - Create a new category (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedData = createCategorySchema.parse(req.body);

    // Check if category name already exists
    const existingCategory = await db
      .select()
      .from(categories)
      .where(eq(categories.name, validatedData.name))
      .limit(1);

    if (existingCategory.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    // Create the category
    const [newCategory] = await db
      .insert(categories)
      .values({
        ...validatedData,
        createdAt: new Date()
      })
      .returning();

    // Log audit event
    await logAuditEvent(req.user!.id, 'CATEGORY_CREATED', newCategory.id, {
      categoryName: newCategory.name
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: newCategory
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    console.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category'
    });
  }
});

// GET /api/categories - List all categories
router.get('/', async (req, res) => {
  try {
    const { 
      page = '1', 
      limit = '10', 
      search = '', 
      includeInactive = 'false' 
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build query conditions
    let conditions = [isNull(categories.deletedAt)];
    
    if (includeInactive !== 'true') {
      conditions.push(eq(categories.isActive, true));
    }

    if (search) {
      conditions.push(ilike(categories.name, `%${search}%`));
    }

    // Get categories with pagination
    const categoriesList = await db
      .select()
      .from(categories)
      .where(conditions.length > 1 ? 
        conditions.reduce((acc, condition) => acc && condition) : 
        conditions[0]
      )
      .orderBy(desc(categories.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: categories.id })
      .from(categories)
      .where(conditions.length > 1 ? 
        conditions.reduce((acc, condition) => acc && condition) : 
        conditions[0]
      );

    res.json({
      success: true,
      data: {
        categories: categoriesList,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount.length,
          totalPages: Math.ceil(totalCount.length / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

// GET /api/categories/:id - Get category details
router.get('/:id', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);

    if (isNaN(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID'
      });
    }

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId) && isNull(categories.deletedAt))
      .limit(1);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: category
    });

  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category'
    });
  }
});

// PUT /api/categories/:id - Update a category (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);

    if (isNaN(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID'
      });
    }

    const validatedData = updateCategorySchema.parse(req.body);

    // Check if category exists
    const [existingCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId) && isNull(categories.deletedAt))
      .limit(1);

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if name is being updated and if it conflicts with existing category
    if (validatedData.name && validatedData.name !== existingCategory.name) {
      const conflictingCategory = await db
        .select()
        .from(categories)
        .where(eq(categories.name, validatedData.name) && isNull(categories.deletedAt))
        .limit(1);

      if (conflictingCategory.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists'
        });
      }
    }

    // Update the category
    const [updatedCategory] = await db
      .update(categories)
      .set(validatedData)
      .where(eq(categories.id, categoryId))
      .returning();

    // Log audit event
    await logAuditEvent(req.user!.id, 'CATEGORY_UPDATED', categoryId, {
      categoryName: updatedCategory.name,
      changes: validatedData
    });

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: updatedCategory
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    console.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update category'
    });
  }
});

// DELETE /api/categories/:id - Soft delete a category (Admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);

    if (isNaN(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID'
      });
    }

    // Check if category exists
    const [existingCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId) && isNull(categories.deletedAt))
      .limit(1);

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Soft delete the category
    const [deletedCategory] = await db
      .update(categories)
      .set({
        deletedAt: new Date(),
        isActive: false
      })
      .where(eq(categories.id, categoryId))
      .returning();

    // Log audit event
    await logAuditEvent(req.user!.id, 'CATEGORY_DELETED', categoryId, {
      categoryName: deletedCategory.name
    });

    res.json({
      success: true,
      message: 'Category deleted successfully',
      data: {
        id: categoryId,
        deletedAt: deletedCategory.deletedAt
      }
    });

  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category'
    });
  }
});

export default router;
