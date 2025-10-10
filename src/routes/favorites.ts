
import express from 'express';
import { db } from '../db/config';
import { users, products, merchants } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

const favoritesSchema = z.object({
  itemId: z.number().int().positive(),
  itemType: z.enum(['merchant', 'product'])
});

// GET /api/favorites - Get user favorites (using user metadata for now)
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const favorites = (user?.metadata as any)?.favorites || [];
    
    res.json({
      success: true,
      data: favorites
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

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const favorites = (user?.metadata as any)?.favorites || [];
    const newFavorite = { itemId, itemType, addedAt: new Date() };
    
    if (!favorites.some((f: any) => f.itemId === itemId && f.itemType === itemType)) {
      favorites.push(newFavorite);
      
      await db
        .update(users)
        .set({ 
          metadata: { ...user?.metadata, favorites }
        })
        .where(eq(users.id, userId));
    }

    res.json({
      success: true,
      message: 'Added to favorites'
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

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let favorites = (user?.metadata as any)?.favorites || [];
    favorites = favorites.filter((f: any) => f.itemId !== itemId);
    
    await db
      .update(users)
      .set({ 
        metadata: { ...user?.metadata, favorites }
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
