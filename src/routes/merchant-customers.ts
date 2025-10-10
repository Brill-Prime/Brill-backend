
import express from 'express';
import { db } from '../db/config';
import { orders, users, merchantProfiles } from '../db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { requireAuth, requireRole } from '../utils/auth';

const router = express.Router();

// GET /api/merchants/:id/customers - Get merchant customers
router.get('/:id/customers', requireAuth, requireRole(['MERCHANT', 'ADMIN']), async (req, res) => {
  try {
    const currentUser = req.user!;
    const merchantId = parseInt(req.params.id);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid merchant ID'
      });
    }

    // Check permissions
    if (currentUser.role !== 'ADMIN' && currentUser.id !== merchantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get unique customers from orders with order counts
    const customerOrders = await db
      .select({
        customerId: orders.customerId,
        customerName: users.fullName,
        customerEmail: users.email,
        customerPhone: users.phone,
        profilePicture: users.profilePicture,
        orderId: orders.id,
        orderStatus: orders.status,
        orderTotal: orders.totalAmount,
        orderDate: orders.createdAt
      })
      .from(orders)
      .innerJoin(users, eq(orders.customerId, users.id))
      .where(and(
        eq(orders.merchantId, merchantId),
        isNull(orders.deletedAt),
        isNull(users.deletedAt)
      ))
      .orderBy(desc(orders.createdAt));

    // Group by customer
    const customersMap = new Map();
    customerOrders.forEach(order => {
      if (!customersMap.has(order.customerId)) {
        customersMap.set(order.customerId, {
          id: order.customerId,
          fullName: order.customerName,
          email: order.customerEmail,
          phone: order.customerPhone,
          profilePicture: order.profilePicture,
          totalOrders: 0,
          totalSpent: 0,
          lastOrderDate: order.orderDate
        });
      }
      const customer = customersMap.get(order.customerId);
      customer.totalOrders++;
      customer.totalSpent += parseFloat(order.orderTotal);
      if (order.orderDate > customer.lastOrderDate) {
        customer.lastOrderDate = order.orderDate;
      }
    });

    const customers = Array.from(customersMap.values());

    res.json({
      success: true,
      data: customers,
      count: customers.length
    });
  } catch (error) {
    console.error('Get merchant customers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve merchant customers'
    });
  }
});

export default router;
