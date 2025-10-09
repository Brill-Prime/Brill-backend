import express from 'express';
import { db } from '../db/config';
import { commodities } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';
import { z } from 'zod';

const router = express.Router();

const commoditySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  unit: z.string().optional(),
  isAvailable: z.boolean().optional(),
});

// Create a new commodity
router.post('/commodities', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const validatedData = commoditySchema.parse(req.body);

    const newCommodity = await db.insert(commodities).values(validatedData).returning();

    res.status(201).json({ 
        success: true, 
        message: 'Commodity created successfully', 
        data: newCommodity[0] 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,
      });
    }
    console.error('Create commodity error:', error);
    res.status(500).json({ success: false, message: 'Failed to create commodity' });
  }
});

// Get all commodities
router.get('/commodities', async (req, res) => {
  try {
    const allCommodities = await db.select().from(commodities).where(isNull(commodities.deletedAt));

    res.json({ success: true, data: allCommodities });
  } catch (error) {
    console.error('Get commodities error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commodities' });
  }
});

// Get a single commodity by ID
router.get('/commodities/:id', async (req, res) => {
  try {
    const commodityId = parseInt(req.params.id);
    const commodity = await db.select().from(commodities).where(and(eq(commodities.id, commodityId), isNull(commodities.deletedAt)));

    if (commodity.length === 0) {
        return res.status(404).json({ success: false, message: 'Commodity not found' });
    }

    res.json({ success: true, data: commodity[0] });
  } catch (error) {
    console.error('Get commodity error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve commodity' });
  }
});

// Update a commodity by ID
router.put('/commodities/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const commodityId = parseInt(req.params.id);
    const validatedData = commoditySchema.partial().parse(req.body);

    const updatedCommodity = await db.update(commodities).set(validatedData).where(eq(commodities.id, commodityId)).returning();

    if (updatedCommodity.length === 0) {
        return res.status(404).json({ success: false, message: 'Commodity not found' });
    }

    res.json({ 
        success: true, 
        message: 'Commodity updated successfully', 
        data: updatedCommodity[0] 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues,
      });
    }
    console.error('Update commodity error:', error);
    res.status(500).json({ success: false, message: 'Failed to update commodity' });
  }
});

// Delete a commodity by ID
router.delete('/commodities/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const commodityId = parseInt(req.params.id);

    const deletedCommodity = await db.update(commodities).set({ deletedAt: new Date() }).where(eq(commodities.id, commodityId)).returning();

    if (deletedCommodity.length === 0) {
        return res.status(404).json({ success: false, message: 'Commodity not found' });
    }

    res.json({ success: true, message: 'Commodity deleted successfully' });
  } catch (error) {
    console.error('Delete commodity error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete commodity' });
  }
});

export default router;
