
import express from 'express';
import { db } from '../db/config';
import { products, users, merchantProfiles, categories } from '../db/schema';
import { eq, and, or, ilike, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../utils/auth';

const router = express.Router();

// Validation schemas
const searchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  type: z.enum(['all', 'products', 'merchants', 'categories']).optional().default('all'),
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20')
});

const productSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  categoryId: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  merchantId: z.string().optional(),
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  sortBy: z.enum(['name', 'price', 'rating', 'newest']).optional().default('name')
});

// GET /api/search - Global search
router.get('/', requireAuth, async (req, res) => {
  try {
    const validatedQuery = searchSchema.parse(req.query);
    const { query, type, page, limit } = validatedQuery;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const results: any = {
      products: [],
      merchants: [],
      categories: []
    };

    // Search products
    if (type === 'all' || type === 'products') {
      const productResults = await db
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          price: products.price,
          imageUrl: products.imageUrl,
          rating: products.rating,
          totalReviews: products.totalReviews,
          merchantName: users.fullName,
          categoryName: categories.name
        })
        .from(products)
        .leftJoin(users, eq(products.merchantId, users.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            or(
              ilike(products.name, `%${query}%`),
              ilike(products.description, `%${query}%`)
            ),
            isNull(products.deletedAt),
            eq(products.isActive, true),
            eq(products.isAvailable, true)
          )
        )
        .limit(type === 'products' ? limitNum : 5)
        .offset(type === 'products' ? offset : 0);

      results.products = productResults.map(p => ({
        ...p,
        type: 'product'
      }));
    }

    // Search merchants
    if (type === 'all' || type === 'merchants') {
      const merchantResults = await db
        .select({
          id: merchantProfiles.id,
          businessName: merchantProfiles.businessName,
          description: merchantProfiles.description,
          businessType: merchantProfiles.businessType,
          location: merchantProfiles.businessAddress,
          isVerified: merchantProfiles.isVerified,
          userDetails: {
            fullName: users.fullName,
            averageRating: users.averageRating,
            totalRatings: users.totalRatings
          }
        })
        .from(merchantProfiles)
        .innerJoin(users, eq(merchantProfiles.userId, users.id))
        .where(
          and(
            or(
              ilike(merchantProfiles.businessName, `%${query}%`),
              ilike(merchantProfiles.description, `%${query}%`),
              ilike(merchantProfiles.businessType, `%${query}%`)
            ),
            isNull(merchantProfiles.deletedAt),
            eq(merchantProfiles.isActive, true),
            eq(merchantProfiles.isVerified, true)
          )
        )
        .limit(type === 'merchants' ? limitNum : 5)
        .offset(type === 'merchants' ? offset : 0);

      results.merchants = merchantResults.map(m => ({
        ...m,
        type: 'merchant'
      }));
    }

    // Search categories
    if (type === 'all' || type === 'categories') {
      const categoryResults = await db
        .select({
          id: categories.id,
          name: categories.name,
          description: categories.description,
          imageUrl: categories.imageUrl
        })
        .from(categories)
        .where(
          and(
            ilike(categories.name, `%${query}%`),
            isNull(categories.deletedAt),
            eq(categories.isActive, true)
          )
        )
        .limit(type === 'categories' ? limitNum : 5)
        .offset(type === 'categories' ? offset : 0);

      results.categories = categoryResults.map(c => ({
        ...c,
        type: 'category'
      }));
    }

    // If searching all, combine results
    let combinedResults = [];
    if (type === 'all') {
      combinedResults = [
        ...results.products,
        ...results.merchants,
        ...results.categories
      ].slice(0, limitNum);
    } else {
      combinedResults = results[type] || [];
    }

    res.json({
      success: true,
      query,
      type,
      results: type === 'all' ? {
        combined: combinedResults,
        breakdown: {
          products: results.products.length,
          merchants: results.merchants.length,
          categories: results.categories.length
        }
      } : combinedResults,
      pagination: {
        page: pageNum,
        limit: limitNum,
        hasMore: combinedResults.length === limitNum
      }
    });
  } catch (error) {
    console.error('Global search error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Search failed'
    });
  }
});

// GET /api/search/products - Advanced product search
router.get('/products', requireAuth, async (req, res) => {
  try {
    const validatedQuery = productSearchSchema.parse(req.query);
    const { query, categoryId, minPrice, maxPrice, merchantId, page, limit, sortBy } = validatedQuery;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build conditions
    const conditions = [
      or(
        ilike(products.name, `%${query}%`),
        ilike(products.description, `%${query}%`)
      ),
      isNull(products.deletedAt),
      eq(products.isActive, true),
      eq(products.isAvailable, true)
    ];

    if (categoryId) {
      conditions.push(eq(products.categoryId, parseInt(categoryId)));
    }

    if (minPrice) {
      conditions.push(sql`CAST(${products.price} AS DECIMAL) >= ${parseFloat(minPrice)}`);
    }

    if (maxPrice) {
      conditions.push(sql`CAST(${products.price} AS DECIMAL) <= ${parseFloat(maxPrice)}`);
    }

    if (merchantId) {
      conditions.push(eq(products.merchantId, parseInt(merchantId)));
    }

    // Define sort order
    let orderBy;
    switch (sortBy) {
      case 'price':
        orderBy = sql`CAST(${products.price} AS DECIMAL) ASC`;
        break;
      case 'rating':
        orderBy = desc(products.rating);
        break;
      case 'newest':
        orderBy = desc(products.createdAt);
        break;
      default:
        orderBy = products.name;
    }

    const productResults = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        unit: products.unit,
        imageUrl: products.imageUrl,
        images: products.images,
        rating: products.rating,
        totalReviews: products.totalReviews,
        stockQuantity: products.stockQuantity,
        merchantId: products.merchantId,
        merchantName: users.fullName,
        categoryId: products.categoryId,
        categoryName: categories.name,
        createdAt: products.createdAt
      })
      .from(products)
      .leftJoin(users, eq(products.merchantId, users.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limitNum)
      .offset(offset);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(products)
      .where(and(...conditions));

    res.json({
      success: true,
      query,
      products: productResults,
      filters: {
        categoryId,
        minPrice,
        maxPrice,
        merchantId,
        sortBy
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(count as string),
        totalPages: Math.ceil(parseInt(count as string) / limitNum)
      }
    });
  } catch (error) {
    console.error('Product search error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Product search failed'
    });
  }
});

export default router;
