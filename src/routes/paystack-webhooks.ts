import express from 'express';
import crypto from 'crypto';
import { db } from '../db/config';
import { transactions, orders, escrows, auditLogs, users } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import EmailService from '../services/email';

const router = express.Router();

// Middleware to verify Paystack webhook signature
const verifyPaystackWebhook = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    console.error('Paystack webhook secret not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const hash = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const signature = req.headers['x-paystack-signature'] as string;

  // Constant-time comparison to prevent timing attacks
  const isValid = crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );

  if (isValid) {
    next();
  } else {
    console.error('Invalid webhook signature received');
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
  const { reference, amount } = transferData;

  try {
    // Find the transaction by its reference
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (!transaction) {
      console.error(`Transaction with reference ${reference} not found.`);
      return;
    }

    // Update the transaction status to COMPLETED
    await db
      .update(transactions)
      .set({ 
        status: 'COMPLETED',
        completedAt: new Date()
      })
      .where(eq(transactions.id, transaction.id));

    // If there is an associated order, find the escrow and update it
    if (transaction.orderId) {
      const [escrow] = await db
        .select()
        .from(escrows)
        .where(eq(escrows.orderId, transaction.orderId))
        .limit(1);

      if (escrow) {
        await db
          .update(escrows)
          .set({ status: 'RELEASED' })
          .where(eq(escrows.id, escrow.id));

        // Get merchant details for email notification
        const [merchant] = await db
          .select()
          .from(users)
          .where(eq(users.id, escrow.payeeId))
          .limit(1);

        // Send email to the merchant
        if (merchant?.email) {
          await EmailService.sendEmail(
            merchant.email,
            'Funds Transferred to Your Account',
            `<p>Hello ${merchant.fullName},</p><p>We have successfully transferred ₦${(amount / 100).toLocaleString()} to your account for order #${transaction.orderId}.</p><p>Thank you for your business!</p>`
          );
        }
      }
    }

    // Log the successful transfer in the audit log
    await db.insert(auditLogs).values({
      userId: transaction.userId,
      action: 'TRANSFER_SUCCESS',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      details: { reference, amount: amount / 100 },
    });

    console.log(`Transfer successful and escrow released for transaction: ${transaction.id}`);

  } catch (error) {
    console.error('Error handling transfer success:', error);
    // Optionally, you could add more robust error handling here, like retrying or sending an admin alert
  }
}

async function handleTransferFailure(transferData: any) {
  const { reference, reason } = transferData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (!transaction) {
      console.error(`Transaction with reference ${reference} not found.`);
      return;
    }

    await db
      .update(transactions)
      .set({ status: 'FAILED' })
      .where(eq(transactions.id, transaction.id));

    if (transaction.orderId) {
      const [escrow] = await db
        .select()
        .from(escrows)
        .where(eq(escrows.orderId, transaction.orderId))
        .limit(1);

      if (escrow) {
        await db
          .update(escrows)
          .set({ status: 'REFUNDED' })
          .where(eq(escrows.id, escrow.id));

        const [merchant] = await db
          .select()
          .from(users)
          .where(eq(users.id, escrow.payeeId))
          .limit(1);

        if (merchant?.email) {
          await EmailService.sendEmail(
            merchant.email,
            'Transfer Failed',
            `<p>Hello ${merchant.fullName},</p><p>The transfer for order #${transaction.orderId} has failed. Please check your account details or contact support.</p><p>Reason: ${reason}</p>`
          );
        }
      }
    }

    await db.insert(auditLogs).values({
      userId: transaction.userId,
      action: 'TRANSFER_FAILURE',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      details: { reference, reason },
    });

    console.log(`Transfer failed for transaction: ${transaction.id}`);

  } catch (error) {
    console.error('Error handling transfer failure:', error);
  }
}

async function handleTransferReversed(transferData: any) {
  const { reference, reason } = transferData;

  try {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, reference))
      .limit(1);

    if (!transaction) {
      console.error(`Transaction with reference ${reference} not found.`);
      return;
    }

    await db
      .update(transactions)
      .set({ status: 'REFUNDED' })
      .where(eq(transactions.id, transaction.id));

    if (transaction.orderId) {
      const [escrow] = await db
        .select()
        .from(escrows)
        .where(eq(escrows.orderId, transaction.orderId))
        .limit(1);

      if (escrow) {
        await db
      .update(escrows)
      .set({ status: 'REFUNDED' })
      .where(eq(escrows.id, escrow.id));

        const [merchant] = await db
          .select()
          .from(users)
          .where(eq(users.id, escrow.payeeId))
          .limit(1);

        if (merchant?.email) {
          await EmailService.sendEmail(
            merchant.email,
            'Transfer Reversed',
            `<p>Hello ${merchant.fullName},</p><p>The transfer for order #${transaction.orderId} has been reversed. Please contact support for more details.</p><p>Reason: ${reason}</p>`
          );
        }
      }
    }

    await db.insert(auditLogs).values({
      userId: transaction.userId,
      action: 'TRANSFER_REVERSED',
      entityType: 'TRANSACTION',
      entityId: transaction.id,
      details: { reference, reason },
    });

    console.log(`Transfer reversed for transaction: ${transaction.id}`);

  } catch (error) {
    console.error('Error handling transfer reversal:', error);
  }
}

export default router;