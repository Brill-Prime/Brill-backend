
import express from 'express';
import { db } from '../db/config';
import { commodities, merchantProfiles } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

const commoditySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  unit: z.string().optional(),
  isAvailable: z.boolean().optional()
});

// GET /api/merchants/:id/commodities - Get merchant's commodities
router.get('/:id/commodities', requireAuth, async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    const merchantCommodities = await db
      .select()
      .from(commodities)
      .where(and(
        eq(commodities.merchantId, merchantId),
        isNull(commodities.deletedAt)
      ));

    res.json({
      success: true,
      data: merchantCommodities
    });
  } catch (error) {
    console.error('Get merchant commodities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commodities'
    });
  }
});

// POST /api/merchants/:id/commodities - Add commodity to merchant
router.post('/:id/commodities', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const merchantId = parseInt(req.params.id);
    const currentUser = req.user!;
    const validatedData = commoditySchema.parse(req.body);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Verify merchant profile exists and user has access
    const [merchantProfile] = await db
      .select()
      .from(merchantProfiles)
      .where(and(
        eq(merchantProfiles.id, merchantId),
        isNull(merchantProfiles.deletedAt)
      ))
      .limit(1);

    if (!merchantProfile) {
      return res.status(404).json({
        success: false,
        message: 'Merchant profile not found'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && merchantProfile.userId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const [newCommodity] = await db
      .insert(commodities)
      .values({
        merchantId,
        ...validatedData
      })
      .returning();

    res.status(201).json({
      success: true,
      message: 'Commodity added successfully',
      data: newCommodity
    });
  } catch (error) {
    console.error('Add commodity error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to add commodity'
    });
  }
});

export default router;
