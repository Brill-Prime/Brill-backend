
import { db } from '../db/config';
import { orders, escrows } from '../db/schema';
import { eq, and, isNull, lt } from 'drizzle-orm';

// Auto-release escrow after 48 hours if consumer doesn't confirm
export async function checkAndReleaseExpiredEscrows() {
  try {
    const now = new Date();

    // Find orders with expired confirmation deadlines
    const expiredOrders = await db
      .select()
      .from(orders)
      .where(and(
        eq(orders.status, 'DELIVERED'),
        lt(orders.confirmationDeadline, now),
        isNull(orders.deletedAt)
      ));

    console.log(`Found ${expiredOrders.length} orders with expired confirmation deadlines`);

    for (const order of expiredOrders) {
      try {
        // Check if escrow exists and is still held
        const [escrow] = await db
          .select()
          .from(escrows)
          .where(and(
            eq(escrows.orderId, order.id),
            eq(escrows.status, 'HELD'),
            isNull(escrows.deletedAt)
          ))
          .limit(1);

        if (escrow) {
          console.log(`Auto-releasing escrow for order ${order.orderNumber}`);

          // Import the release function
          const { releaseEscrowFunds } = await import('../routes/escrows');
          
          // System auto-release (use system user ID = 1 or a dedicated system ID)
          const result = await releaseEscrowFunds(order.id, 1, true);

          if (result.success) {
            console.log(`Successfully auto-released escrow for order ${order.orderNumber}`);
          } else {
            console.error(`Failed to auto-release escrow for order ${order.orderNumber}:`, result.message);
          }
        }
      } catch (error) {
        console.error(`Error processing order ${order.orderNumber}:`, error);
      }
    }

    return {
      success: true,
      processed: expiredOrders.length
    };
  } catch (error) {
    console.error('Error in checkAndReleaseExpiredEscrows:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Run this function periodically (e.g., every hour)
export function startEscrowAutoReleaseService() {
  // Run immediately on startup
  checkAndReleaseExpiredEscrows();

  // Then run every hour
  setInterval(() => {
    checkAndReleaseExpiredEscrows();
  }, 60 * 60 * 1000); // 1 hour

  console.log('✅ Escrow auto-release service started');
}
