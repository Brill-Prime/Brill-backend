import express from 'express';
import crypto from 'crypto';
import { db } from '../db/config';
import { transactions, orders, escrows, auditLogs } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';

const router = express.Router();

// Middleware to verify Paystack webhook signature
const verifyPaystackWebhook = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    console.warn('Paystack webhook secret not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const hash = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash === req.headers['x-paystack-signature']) {
    next();
  } else {
    res.status(400).json({ error: 'Invalid signature' });
  }
};

// Webhook endpoint for payment confirmations
router.post('/webhook', express.json(), verifyPaystackWebhook, async (req, res) => {
  try {
    const event = req.body;

    switch (event.event) {
      case 'charge.success':
        await handlePaymentSuccess(event.data);
        break;
      case 'charge.failed':
        await handlePaymentFailure(event.data);
        break;
      case 'transfer.success':
        await handleTransferSuccess(event.data);
        break;
      case 'transfer.failed':
        await handleTransferFailure(event.data);
        break;
      case 'transfer.reversed':
        await handleTransferReversed(event.data);
        break;
      default:
        console.log('Unhandled webhook event:', event.event);
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handlePaymentSuccess(paymentData: any) {
  const { reference, amount, customer } = paymentData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (!transaction) {
      console.error('Transaction not found:', reference);
      return;
    }

    // Update transaction status
    await db
      .update(transactions)
      .set({ 
        status: 'COMPLETED',
        paymentGatewayRef: reference,
        paystackTransactionId: paymentData.id?.toString(),
        completedAt: new Date()
      })
      .where(eq(transactions.id, transaction.id));

    // Update order and create escrow if order exists
    if (transaction.orderId) {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, transaction.orderId))
        .limit(1);

      if (order) {
        await db
          .update(orders)
          .set({ 
            status: 'CONFIRMED',
            updatedAt: new Date()
          })
          .where(eq(orders.id, order.id));

        // Create escrow to hold funds
        const existingEscrow = await db
          .select()
          .from(escrows)
          .where(and(
            eq(escrows.orderId, order.id),
            isNull(escrows.deletedAt)
          ))
          .limit(1);

        if (!existingEscrow.length && order.merchantId) {
          await db.insert(escrows).values({
            orderId: order.id,
            payerId: order.customerId,
            payeeId: order.merchantId,
            amount: transaction.amount,
            status: 'HELD',
            paystackEscrowId: reference,
            transactionRef: reference,
            createdAt: new Date()
          });
        }
      }
    }

    // Log audit event
    await db.insert(auditLogs).values({
      userId: transaction.userId,
      action: 'PAYMENT_SUCCESS',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      details: {
        reference,
        amount: amount / 100,
        paystackId: paymentData.id
      }
    });

    console.log(`Payment successful for transaction ${transaction.id}`);
  } catch (error) {
    console.error('Error handling payment success:', error);
  }
}

async function handlePaymentFailure(paymentData: any) {
  const { reference } = paymentData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (!transaction) {
      console.error('Transaction not found:', reference);
      return;
    }

    await db
      .update(transactions)
      .set({ 
        status: 'FAILED',
        paymentGatewayRef: reference
      })
      .where(eq(transactions.id, transaction.id));

    await db.insert(auditLogs).values({
      userId: transaction.userId,
      action: 'PAYMENT_FAILED',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      details: {
        reference,
        reason: paymentData.gateway_response
      }
    });

    console.log(`Payment failed: ${reference}`);
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

async function handleTransferSuccess(transferData: any) {
  const { reference } = transferData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (transaction) {
      await db
        .update(transactions)
        .set({ 
          status: 'COMPLETED',
          completedAt: new Date()
        })
        .where(eq(transactions.id, transaction.id));
    }

    console.log(`Transfer successful: ${reference}`);
  } catch (error) {
    console.error('Error handling transfer success:', error);
  }
}

async function handleTransferFailure(transferData: any) {
  const { reference } = transferData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (transaction) {
      await db
        .update(transactions)
        .set({ 
          status: 'FAILED'
        })
        .where(eq(transactions.id, transaction.id));
    }

    console.log(`Transfer failed: ${reference}`);
  } catch (error) {
    console.error('Error handling transfer failure:', error);
  }
}

async function handleTransferReversed(transferData: any) {
  const { reference } = transferData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (transaction) {
      await db
        .update(transactions)
        .set({ 
          status: 'REFUNDED'
        })
        .where(eq(transactions.id, transaction.id));
    }

    console.log(`Transfer reversed: ${reference}`);
  } catch (error) {
    console.error('Error handling transfer reversal:', error);
  }
}

export default router;