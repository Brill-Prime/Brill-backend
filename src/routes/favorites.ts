
import express from 'express';
import { db } from '../db/config';
import { users, products, merchantProfiles } from '../db/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

const favoritesSchema = z.object({
  itemId: z.number().int().positive(),
  itemType: z.enum(['merchant', 'product'])
});

// GET /api/favorites - Get user favorites with full details
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const favoritesData = (user?.metadata as any)?.favorites || [];
    
    // Enrich favorites with actual item data
    const enrichedFavorites = await Promise.all(
      favoritesData.map(async (fav: any) => {
        if (fav.itemType === 'product') {
          const [product] = await db
            .select({
              id: products.id,
              name: products.name,
              price: products.price,
              imageUrl: products.imageUrl,
              rating: products.rating,
              isAvailable: products.isAvailable
            })
            .from(products)
            .where(and(eq(products.id, fav.itemId), isNull(products.deletedAt)))
            .limit(1);
          
          return { ...fav, details: product || null };
        } else if (fav.itemType === 'merchant') {
          const [merchant] = await db
            .select({
              id: merchantProfiles.id,
              businessName: merchantProfiles.businessName,
              businessAddress: merchantProfiles.businessAddress,
              isOpen: merchantProfiles.isOpen,
              user: {
                id: users.id,
                fullName: users.fullName,
                profilePicture: users.profilePicture,
                averageRating: users.averageRating
              }
            })
            .from(merchantProfiles)
            .leftJoin(users, eq(merchantProfiles.userId, users.id))
            .where(and(eq(merchantProfiles.id, fav.itemId), isNull(merchantProfiles.deletedAt)))
            .limit(1);
          
          return { ...fav, details: merchant || null };
        }
        return fav;
      })
    );
    
    res.json({
      success: true,
      data: enrichedFavorites.filter(f => f.details !== null)
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ success: false, message: 'Failed to get favorites' });
  }
});

// POST /api/favorites - Add to favorites
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validation = favoritesSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.error.errors
      });
    }

    const { itemId, itemType } = validation.data;

    // Verify item exists
    if (itemType === 'product') {
      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, itemId), isNull(products.deletedAt)))
        .limit(1);
      
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }
    } else if (itemType === 'merchant') {
      const [merchant] = await db
        .select()
        .from(merchantProfiles)
        .where(and(eq(merchantProfiles.id, itemId), isNull(merchantProfiles.deletedAt)))
        .limit(1);
      
      if (!merchant) {
        return res.status(404).json({ success: false, message: 'Merchant not found' });
      }
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const favorites = (user?.metadata as any)?.favorites || [];
    const newFavorite = { itemId, itemType, addedAt: new Date().toISOString() };
    
    if (!favorites.some((f: any) => f.itemId === itemId && f.itemType === itemType)) {
      favorites.push(newFavorite);
      
      await db
        .update(users)
        .set({ 
          metadata: { ...(user?.metadata || {}), favorites },
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
    }

    res.json({
      success: true,
      message: 'Added to favorites',
      data: newFavorite
    });
  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({ success: false, message: 'Failed to add favorite' });
  }
});

// DELETE /api/favorites/:itemId - Remove from favorites
router.delete('/:itemId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const itemId = parseInt(req.params.itemId);
    const itemType = req.query.type as string;

    if (isNaN(itemId)) {
      return res.status(400).json({ success: false, message: 'Invalid item ID' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let favorites = (user?.metadata as any)?.favorites || [];
    
    if (itemType) {
      favorites = favorites.filter((f: any) => !(f.itemId === itemId && f.itemType === itemType));
    } else {
      favorites = favorites.filter((f: any) => f.itemId !== itemId);
    }
    
    await db
      .update(users)
      .set({ 
        metadata: { ...(user?.metadata || {}), favorites },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    res.json({
      success: true,
      message: 'Removed from favorites'
    });
  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove favorite' });
  }
});

export default router;
