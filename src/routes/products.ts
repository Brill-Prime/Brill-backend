
import express from 'express';
import { db } from '../db/config';
import { products, categories, users, auditLogs } from '../db/schema';
import { eq, isNull, ilike, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Price must be a positive number"
  }),
  categoryId: z.number().int().positive(),
  unit: z.string().min(1),
  stockQuantity: z.number().int().min(0).default(0),
  stockLevel: z.number().int().min(0).default(0),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).default([]),
  isAvailable: z.boolean().default(true),
  isActive: z.boolean().default(true)
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Price must be a positive number"
  }).optional(),
  categoryId: z.number().int().positive().optional(),
  unit: z.string().min(1).optional(),
  stockQuantity: z.number().int().min(0).optional(),
  stockLevel: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional()
});

// Helper function to log audit events
const logAuditEvent = async (userId: number, action: string, entityType: string, entityId: number, details: any) => {
  try {
    await db.insert(auditLogs).values({
      userId,
      action,
      entityType,
      entityId,
      details
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

// POST /api/products - Create a new product
router.post('/', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const validatedData = createProductSchema.parse(req.body);
    const currentUser = req.user!;

    // Check if category exists
    const category = await db
      .select()
      .from(categories)
      .where(and(
        eq(categories.id, validatedData.categoryId),
        isNull(categories.deletedAt)
      ))
      .limit(1);

    if (!category.length) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // For merchants, they can only create products for themselves
    // For admins, they need to specify merchantId or it defaults to their own ID
    let merchantId = currentUser.id;
    let sellerId = currentUser.id;

    if (currentUser.role === 'ADMIN' && req.body.merchantId) {
      merchantId = req.body.merchantId;
      sellerId = req.body.merchantId;
    }

    const newProduct = await db.insert(products).values({
      merchantId,
      sellerId,
      name: validatedData.name,
      description: validatedData.description,
      price: validatedData.price,
      categoryId: validatedData.categoryId,
      unit: validatedData.unit,
      stockQuantity: validatedData.stockQuantity,
      stockLevel: validatedData.stockLevel,
      imageUrl: validatedData.imageUrl,
      images: validatedData.images,
      isAvailable: validatedData.isAvailable,
      isActive: validatedData.isActive,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'PRODUCT_CREATED',
      'PRODUCT',
      newProduct[0].id,
      { productName: newProduct[0].name }
    );

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: newProduct[0]
    });
  } catch (error) {
    console.error('Create product error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create product'
    });
  }
});

// GET /api/products - List all products
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
    const merchantId = req.query.merchantId ? parseInt(req.query.merchantId as string) : undefined;
    const isAvailable = req.query.isAvailable === 'true' ? true : req.query.isAvailable === 'false' ? false : undefined;
    
    const offset = (page - 1) * limit;

    // Build query conditions
    const conditions = [
      isNull(products.deletedAt),
      eq(products.isActive, true)
    ];

    if (search) {
      conditions.push(ilike(products.name, `%${search}%`));
    }

    if (categoryId) {
      conditions.push(eq(products.categoryId, categoryId));
    }

    if (merchantId) {
      conditions.push(eq(products.merchantId, merchantId));
    }

    if (isAvailable !== undefined) {
      conditions.push(eq(products.isAvailable, isAvailable));
    }

    const allProducts = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name,
        unit: products.unit,
        stockQuantity: products.stockQuantity,
        stockLevel: products.stockLevel,
        imageUrl: products.imageUrl,
        images: products.images,
        isAvailable: products.isAvailable,
        isActive: products.isActive,
        rating: products.rating,
        totalReviews: products.totalReviews,
        merchantId: products.merchantId,
        merchantName: users.fullName,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(users, eq(products.merchantId, users.id))
      .where(and(...conditions))
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: products.id })
      .from(products)
      .where(and(...conditions));

    res.json({
      success: true,
      data: allProducts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.length / limit),
        totalItems: totalCount.length,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
});

// GET /api/products/:id - Get product details
router.get('/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    
    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    const product = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name,
        unit: products.unit,
        stockQuantity: products.stockQuantity,
        stockLevel: products.stockLevel,
        imageUrl: products.imageUrl,
        images: products.images,
        isAvailable: products.isAvailable,
        isActive: products.isActive,
        rating: products.rating,
        totalReviews: products.totalReviews,
        merchantId: products.merchantId,
        sellerId: products.sellerId,
        merchantName: users.fullName,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(users, eq(products.merchantId, users.id))
      .where(and(
        eq(products.id, productId),
        isNull(products.deletedAt)
      ))
      .limit(1);

    if (!product.length) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product[0]
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product'
    });
  }
});

// PUT /api/products/:id - Update a product
router.put('/:id', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    const validatedData = updateProductSchema.parse(req.body);

    // Check if product exists
    const existingProduct = await db
      .select()
      .from(products)
      .where(and(
        eq(products.id, productId),
        isNull(products.deletedAt)
      ))
      .limit(1);

    if (!existingProduct.length) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check ownership (merchants can only update their own products)
    if (currentUser.role === 'MERCHANT' && existingProduct[0].merchantId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own products'
      });
    }

    // Check if category exists (if categoryId is being updated)
    if (validatedData.categoryId) {
      const category = await db
        .select()
        .from(categories)
        .where(and(
          eq(categories.id, validatedData.categoryId),
          isNull(categories.deletedAt)
        ))
        .limit(1);

      if (!category.length) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    const updatedProduct = await db
      .update(products)
      .set({
        ...validatedData,
        updatedAt: new Date()
      })
      .where(eq(products.id, productId))
      .returning();

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'PRODUCT_UPDATED',
      'PRODUCT',
      productId,
      { productName: updatedProduct[0].name, changes: validatedData }
    );

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct[0]
    });
  } catch (error) {
    console.error('Update product error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update product'
    });
  }
});

// DELETE /api/products/:id - Soft delete a product
router.delete('/:id', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const currentUser = req.user!;
    
    if (isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }

    // Check if product exists
    const existingProduct = await db
      .select()
      .from(products)
      .where(and(
        eq(products.id, productId),
        isNull(products.deletedAt)
      ))
      .limit(1);

    if (!existingProduct.length) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check ownership (merchants can only delete their own products)
    if (currentUser.role === 'MERCHANT' && existingProduct[0].merchantId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own products'
      });
    }

    // Soft delete the product
    await db
      .update(products)
      .set({
        deletedAt: new Date(),
        isActive: false,
        isAvailable: false
      })
      .where(eq(products.id, productId));

    // Log audit event
    await logAuditEvent(
      currentUser.id,
      'PRODUCT_DELETED',
      'PRODUCT',
      productId,
      { productName: existingProduct[0].name }
    );

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product'
    });
  }
});

// GET /api/products/merchant/:id - List products by merchant
router.get('/merchant/:id', async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    const offset = (page - 1) * limit;

    // Check if merchant exists
    const merchant = await db
      .select()
      .from(users)
      .where(and(
        eq(users.id, merchantId),
        isNull(users.deletedAt)
      ))
      .limit(1);

    if (!merchant.length) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found'
      });
    }

    const merchantProducts = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        categoryId: products.categoryId,
        categoryName: categories.name,
        unit: products.unit,
        stockQuantity: products.stockQuantity,
        stockLevel: products.stockLevel,
        imageUrl: products.imageUrl,
        images: products.images,
        isAvailable: products.isAvailable,
        isActive: products.isActive,
        rating: products.rating,
        totalReviews: products.totalReviews,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        eq(products.merchantId, merchantId),
        isNull(products.deletedAt),
        eq(products.isActive, true)
      ))
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: products.id })
      .from(products)
      .where(and(
        eq(products.merchantId, merchantId),
        isNull(products.deletedAt),
        eq(products.isActive, true)
      ));

    res.json({
      success: true,
      data: {
        merchant: {
          id: merchant[0].id,
          fullName: merchant[0].fullName,
          email: merchant[0].email
        },
        products: merchantProducts
      },
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.length / limit),
        totalItems: totalCount.length,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get merchant products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch merchant products'
    });
  }
});

// GET /api/products/category/:id - List products by category
router.get('/category/:id', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    if (isNaN(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID'
      });
    }

    const offset = (page - 1) * limit;

    // Check if category exists
    const category = await db
      .select()
      .from(categories)
      .where(and(
        eq(categories.id, categoryId),
        isNull(categories.deletedAt)
      ))
      .limit(1);

    if (!category.length) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const categoryProducts = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        unit: products.unit,
        stockQuantity: products.stockQuantity,
        stockLevel: products.stockLevel,
        imageUrl: products.imageUrl,
        images: products.images,
        isAvailable: products.isAvailable,
        isActive: products.isActive,
        rating: products.rating,
        totalReviews: products.totalReviews,
        merchantId: products.merchantId,
        merchantName: users.fullName,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt
      })
      .from(products)
      .leftJoin(users, eq(products.merchantId, users.id))
      .where(and(
        eq(products.categoryId, categoryId),
        isNull(products.deletedAt),
        eq(products.isActive, true),
        eq(products.isAvailable, true)
      ))
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const totalCount = await db
      .select({ count: products.id })
      .from(products)
      .where(and(
        eq(products.categoryId, categoryId),
        isNull(products.deletedAt),
        eq(products.isActive, true),
        eq(products.isAvailable, true)
      ));

    res.json({
      success: true,
      data: {
        category: {
          id: category[0].id,
          name: category[0].name,
          description: category[0].description,
          imageUrl: category[0].imageUrl
        },
        products: categoryProducts
      },
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount.length / limit),
        totalItems: totalCount.length,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Get category products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category products'
    });
  }
});

export default router;
