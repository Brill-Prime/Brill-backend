
import express from 'express';
import { z } from 'zod';
import { db } from '../db/config';
import { tollGates, auditLogs } from '../db/schema';
import { eq, and, desc, gte, lte, ilike, or, sql, isNull } from 'drizzle-orm';
import { requireAuth, requireAdmin, requireRole } from '../utils/auth';

const router = express.Router();

// Validation schemas
const createTollGateSchema = z.object({
  name: z.string().min(1, 'Toll gate name is required'),
  location: z.string().min(1, 'Location is required'),
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  price: z.number().positive('Price must be positive'),
  operatingHours: z.record(z.string(), z.any()).optional().default({}),
  isActive: z.boolean().optional().default(true)
});

const updateTollGateSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  price: z.number().positive().optional(),
  operatingHours: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().optional()
});

const tollGatesQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  search: z.string().optional(),
  isActive: z.string().optional(),
  location: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional()
});

// POST /api/toll-gates - Create a new toll gate (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const validatedData = createTollGateSchema.parse(req.body);

    // Check if toll gate with same name already exists
    const existingTollGate = await db
      .select()
      .from(tollGates)
      .where(and(
        eq(tollGates.name, validatedData.name),
        isNull(tollGates.deletedAt)
      ))
      .limit(1);

    if (existingTollGate.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Toll gate with this name already exists'
      });
    }

    const newTollGate = await db
      .insert(tollGates)
      .values({
        name: validatedData.name,
        location: validatedData.location,
        latitude: validatedData.latitude.toString(),
        longitude: validatedData.longitude.toString(),
        price: validatedData.price.toString(),
        operatingHours: validatedData.operatingHours,
        isActive: validatedData.isActive
      })
      .returning();

    // Log the action
    await db.insert(auditLogs).values({
      userId: req.user?.id,
      action: 'TOLL_GATE_CREATED',
      entityType: 'TOLL_GATE',
      entityId: newTollGate[0].id,
      details: { tollGateName: newTollGate[0].name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: 'Toll gate created successfully',
      data: newTollGate[0]
    });

  } catch (error) {
    console.error('Create toll gate error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create toll gate'
    });
  }
});

// GET /api/toll-gates - List all toll gates
router.get('/', async (req, res) => {
  try {
    const query = tollGatesQuerySchema.parse(req.query);
    const page = parseInt(query.page);
    const limit = Math.min(parseInt(query.limit), 100);
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [isNull(tollGates.deletedAt)];

    if (query.search) {
      conditions.push(
        or(
          ilike(tollGates.name, `%${query.search}%`),
          ilike(tollGates.location, `%${query.search}%`)
        )
      );
    }

    if (query.isActive !== undefined) {
      conditions.push(eq(tollGates.isActive, query.isActive === 'true'));
    }

    if (query.location) {
      conditions.push(ilike(tollGates.location, `%${query.location}%`));
    }

    if (query.minPrice) {
      conditions.push(gte(tollGates.price, query.minPrice));
    }

    if (query.maxPrice) {
      conditions.push(lte(tollGates.price, query.maxPrice));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    // Get total count
    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tollGates)
      .where(whereClause);
    
    const totalCount = Number(totalCountResult[0]?.count) || 0;

    // Get toll gates
    const tollGatesList = await db
      .select()
      .from(tollGates)
      .where(whereClause)
      .orderBy(desc(tollGates.createdAt))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: tollGatesList,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('List toll gates error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch toll gates'
    });
  }
});

// GET /api/toll-gates/:id - Get toll gate details
router.get('/:id', async (req, res) => {
  try {
    const tollGateId = parseInt(req.params.id);

    if (isNaN(tollGateId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid toll gate ID'
      });
    }

    const tollGate = await db
      .select()
      .from(tollGates)
      .where(and(
        eq(tollGates.id, tollGateId),
        isNull(tollGates.deletedAt)
      ))
      .limit(1);

    if (tollGate.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Toll gate not found'
      });
    }

    res.json({
      success: true,
      data: tollGate[0]
    });

  } catch (error) {
    console.error('Get toll gate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch toll gate'
    });
  }
});

// PUT /api/toll-gates/:id - Update toll gate details (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tollGateId = parseInt(req.params.id);

    if (isNaN(tollGateId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid toll gate ID'
      });
    }

    const validatedData = updateTollGateSchema.parse(req.body);

    // Check if toll gate exists
    const existingTollGate = await db
      .select()
      .from(tollGates)
      .where(and(
        eq(tollGates.id, tollGateId),
        isNull(tollGates.deletedAt)
      ))
      .limit(1);

    if (existingTollGate.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Toll gate not found'
      });
    }

    // Check if name is being updated and if it conflicts with existing toll gate
    if (validatedData.name) {
      const nameConflict = await db
        .select()
        .from(tollGates)
        .where(and(
          eq(tollGates.name, validatedData.name),
          eq(tollGates.id, tollGateId),
          isNull(tollGates.deletedAt)
        ))
        .limit(1);

      if (nameConflict.length > 0 && nameConflict[0].id !== tollGateId) {
        return res.status(400).json({
          success: false,
          message: 'Toll gate with this name already exists'
        });
      }
    }

    // Update toll gate - convert numbers to strings for decimal fields
    const updateData: any = {};
    if (validatedData.name) updateData.name = validatedData.name;
    if (validatedData.location) updateData.location = validatedData.location;
    if (validatedData.latitude) updateData.latitude = validatedData.latitude.toString();
    if (validatedData.longitude) updateData.longitude = validatedData.longitude.toString();
    if (validatedData.price) updateData.price = validatedData.price.toString();
    if (validatedData.operatingHours) updateData.operatingHours = validatedData.operatingHours;
    if (validatedData.isActive !== undefined) updateData.isActive = validatedData.isActive;

    const updatedTollGate = await db
      .update(tollGates)
      .set(updateData)
      .where(eq(tollGates.id, tollGateId))
      .returning();

    // Log the action
    await db.insert(auditLogs).values({
      userId: req.user?.id,
      action: 'TOLL_GATE_UPDATED',
      entityType: 'TOLL_GATE',
      entityId: tollGateId,
      details: { 
        updates: validatedData,
        tollGateName: updatedTollGate[0].name 
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: 'Toll gate updated successfully',
      data: updatedTollGate[0]
    });

  } catch (error) {
    console.error('Update toll gate error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update toll gate'
    });
  }
});

export default router;
