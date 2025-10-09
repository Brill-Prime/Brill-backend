import express from 'express';
import { db } from '../db/config';
import { products, merchantProfiles } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

const inventoryItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  quantity: z.number().int().min(0),
  categoryId: z.number().int().positive(),
});

// Add an item to a merchant's inventory
router.post('/merchants/:id/inventory', requireAuth, requireRole(['MERCHANT']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);
    const validatedData = inventoryItemSchema.parse(req.body);

    const merchantProfile = await db.select().from(merchantProfiles).where(and(eq(merchantProfiles.userId, currentUser.id), eq(merchantProfiles.id, merchantId)));

    if (merchantProfile.length === 0) {
        return res.status(403).json({ 
            success: false, 
            message: 'Access denied. You can only add inventory to your own merchant profile.' 
        });
    }

    const newItem = await db.insert(products).values({
        ...validatedData,
        merchantId: merchantId,
    }).returning();

    res.status(201).json({ 
        success: true, 
        message: 'Inventory item added successfully', 
        data: newItem[0] 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,
      });
    }
    console.error('Add inventory item error:', error);
    res.status(500).json({ success: false, message: 'Failed to add inventory item' });
  }
});

// Get a merchant's inventory
router.get('/merchants/:id/inventory', requireAuth, async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);

    const inventory = await db.select().from(products).where(and(eq(products.merchantId, merchantId), isNull(products.deletedAt)));

    res.json({ success: true, data: inventory });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve inventory' });
  }
});

export default router;
