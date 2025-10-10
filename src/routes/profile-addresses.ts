import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { users, auditLogs } from '../db/schema';
import { eq, isNull } from 'drizzle-orm';
import { requireAuth } from '../utils/auth';

const router = express.Router();

const addressSchema = z.object({
  label: z.string().min(1).max(50),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().optional(),
  country: z.string().default('Nigeria'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().default(false)
});

// GET /api/profile/addresses - Get user's saved addresses
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const addresses = (user?.metadata as any)?.addresses || [];

    res.json({
      success: true,
      data: addresses
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ success: false, message: 'Failed to get addresses' });
  }
});

// POST /api/profile/addresses - Add new address
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const validatedData = addressSchema.parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let addresses = (user?.metadata as any)?.addresses || [];

    // If this is the default address, unset other defaults
    if (validatedData.isDefault) {
      addresses = addresses.map((addr: any) => ({ ...addr, isDefault: false }));
    }

    const newAddress = {
      id: Date.now(),
      ...validatedData,
      createdAt: new Date().toISOString()
    };

    addresses.push(newAddress);

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), addresses },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'ADDRESS_ADDED',
      entityType: 'USER',
      entityId: userId,
      details: { addressLabel: validatedData.label }
    });

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: newAddress
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    console.error('Add address error:', error);
    res.status(500).json({ success: false, message: 'Failed to add address' });
  }
});

// PUT /api/profile/addresses/:id - Update address
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const addressId = parseInt(req.params.id);
    const validatedData = addressSchema.partial().parse(req.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let addresses = (user?.metadata as any)?.addresses || [];
    const addressIndex = addresses.findIndex((a: any) => a.id === addressId);

    if (addressIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // If this is being set as default, unset other defaults
    if (validatedData.isDefault) {
      addresses = addresses.map((addr: any) => ({ ...addr, isDefault: false }));
    }

    addresses[addressIndex] = {
      ...addresses[addressIndex],
      ...validatedData,
      updatedAt: new Date().toISOString()
    };

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), addresses },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'ADDRESS_UPDATED',
      entityType: 'USER',
      entityId: userId,
      details: { addressId }
    });

    res.json({
      success: true,
      message: 'Address updated successfully',
      data: addresses[addressIndex]
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    console.error('Update address error:', error);
    res.status(500).json({ success: false, message: 'Failed to update address' });
  }
});

// DELETE /api/profile/addresses/:id - Delete address
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const addressId = parseInt(req.params.id);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let addresses = (user?.metadata as any)?.addresses || [];
    addresses = addresses.filter((a: any) => a.id !== addressId);

    await db
      .update(users)
      .set({
        metadata: { ...(user?.metadata || {}), addresses },
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      userId,
      action: 'ADDRESS_DELETED',
      entityType: 'USER',
      entityId: userId,
      details: { addressId }
    });

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete address' });
  }
});

export default router;