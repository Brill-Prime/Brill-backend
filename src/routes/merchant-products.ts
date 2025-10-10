
import express from 'express';
import { db } from '../db/config';
import { products, users, categories } from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// GET /api/merchants/:merchantId/products - Get merchant products
router.get('/:merchantId/products', requireAuth, async (req, res) => {
  try {
    const merchantId = parseInt(req.params.merchantId);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    const merchantProducts = await db
      .select({
        product: products,
        category: {
          id: categories.id,
          name: categories.name
        }
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        eq(products.merchantId, merchantId),
        isNull(products.deletedAt)
      ))
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    const totalCount = await db
      .select({ count: products.id })
      .from(products)
      .where(and(
        eq(products.merchantId, merchantId),
        isNull(products.deletedAt)
      ));

    res.json({
      success: true,
      data: merchantProducts,
      pagination: {
        page,
        limit,
        total: totalCount.length,
        pages: Math.ceil(totalCount.length / limit)
      }
    });
  } catch (error) {
    console.error('Get merchant products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant products'
    });
  }
});

// POST /api/merchants/:merchantId/products - Create merchant product
router.post('/:merchantId/products', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const merchantId = parseInt(req.params.merchantId);
    const currentUser = req.user!;

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Verify merchant ownership or admin
    if (currentUser.role !== 'ADMIN' && currentUser.id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { name, description, price, categoryId, unit, stockQuantity, imageUrl, images } = req.body;

    const newProduct = await db.insert(products).values({
      merchantId,
      sellerId: merchantId,
      name,
      description,
      price,
      categoryId,
      unit,
      stockQuantity: stockQuantity || 0,
      stockLevel: stockQuantity || 0,
      imageUrl,
      images: images || [],
      isAvailable: true,
      isActive: true
    }).returning();

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: newProduct[0]
    });
  } catch (error) {
    console.error('Create merchant product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product'
    });
  }
});

export default router;
