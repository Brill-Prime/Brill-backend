
import crypto from 'crypto';
import { db } from '../db/config';
import { transactions, orders, auditLogs } from '../db/schema';
import { eq } from 'drizzle-orm';

interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    gateway_response?: string;
    paid_at?: string;
    created_at?: string;
    customer: {
      id: number;
      email: string;
      customer_code: string;
    };
    metadata?: any;
  };
}

class PaystackService {
  private static readonly SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  private static readonly WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

  // Verify webhook signature
  static verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.WEBHOOK_SECRET) {
      console.warn('Paystack webhook secret not configured');
      return false;
    }

    const hash = crypto
      .createHmac('sha512', this.WEBHOOK_SECRET)
      .update(payload, 'utf8')
      .digest('hex');

    return hash === signature;
  }

  // Process webhook event
  static async processWebhookEvent(event: PaystackWebhookEvent): Promise<void> {
    try {
      switch (event.event) {
        case 'charge.success':
          await this.handleSuccessfulPayment(event.data);
          break;
        case 'charge.failed':
          await this.handleFailedPayment(event.data);
          break;
        case 'transfer.success':
          await this.handleSuccessfulTransfer(event.data);
          break;
        case 'transfer.failed':
          await this.handleFailedTransfer(event.data);
          break;
        case 'transfer.reversed':
          await this.handleReversedTransfer(event.data);
          break;
        default:
          console.log(`Unhandled Paystack event: ${event.event}`);
      }
    } catch (error) {
      console.error('Error processing Paystack webhook:', error);
      throw error;
    }
  }

  // Handle successful payment
  private static async handleSuccessfulPayment(data: any): Promise<void> {
    try {
      // Find transaction by reference
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.transactionRef, data.reference))
        .limit(1);

      if (!transaction) {
        console.warn(`Transaction not found for reference: ${data.reference}`);
        return;
      }

      // Update transaction status
      const metadata = (transaction.metadata as Record<string, any>) || {};
      const updatedTransaction = await db
        .update(transactions)
        .set({
          status: 'COMPLETED',
          paymentGatewayRef: data.reference,
          paystackTransactionId: data.id.toString(),
          completedAt: new Date(data.paid_at || data.created_at),
          metadata: {
            ...metadata,
            paystack: data
          } as any
        })
        .where(eq(transactions.id, transaction.id))
        .returning();

      // Update associated order if exists
      if (transaction.orderId) {
        await db
          .update(orders)
          .set({
            status: 'CONFIRMED',
            updatedAt: new Date()
          })
          .where(eq(orders.id, transaction.orderId));
      }

      // Log audit event
      await db.insert(auditLogs).values({
        userId: transaction.userId,
        action: 'PAYMENT_SUCCESS',
        entityType: 'TRANSACTION',
        entityId: transaction.id,
        details: {
          reference: data.reference,
          amount: data.amount / 100, // Paystack amounts are in kobo
          paystackId: data.id
        }
      });

      console.log(`Payment successful for transaction ${transaction.id}`);
    } catch (error) {
      console.error('Error handling successful payment:', error);
      throw error;
    }
  }

  // Handle failed payment
  private static async handleFailedPayment(data: any): Promise<void> {
    try {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.transactionRef, data.reference))
        .limit(1);

      if (!transaction) {
        console.warn(`Transaction not found for reference: ${data.reference}`);
        return;
      }

      const metadata = (transaction.metadata as Record<string, any>) || {};
      await db
        .update(transactions)
        .set({
          status: 'FAILED',
          paymentGatewayRef: data.reference,
          paystackTransactionId: data.id.toString(),
          metadata: {
            ...metadata,
            paystack: data,
            failureReason: data.gateway_response
          } as any
        })
        .where(eq(transactions.id, transaction.id));

      // Log audit event
      await db.insert(auditLogs).values({
        userId: transaction.userId,
        action: 'PAYMENT_FAILED',
        entityType: 'TRANSACTION',
        entityId: transaction.id,
        details: {
          reference: data.reference,
          reason: data.gateway_response,
          paystackId: data.id
        }
      });

      console.log(`Payment failed for transaction ${transaction.id}`);
    } catch (error) {
      console.error('Error handling failed payment:', error);
      throw error;
    }
  }

  // Handle successful transfer
  private static async handleSuccessfulTransfer(data: any): Promise<void> {
    try {
      // Handle transfer success logic here
      console.log('Transfer successful:', data);
    } catch (error) {
      console.error('Error handling successful transfer:', error);
      throw error;
    }
  }

  // Handle failed transfer
  private static async handleFailedTransfer(data: any): Promise<void> {
    try {
      // Handle transfer failure logic here
      console.log('Transfer failed:', data);
    } catch (error) {
      console.error('Error handling failed transfer:', error);
      throw error;
    }
  }

  // Handle reversed transfer
  private static async handleReversedTransfer(data: any): Promise<void> {
    try {
      // Handle transfer reversal logic here
      console.log('Transfer reversed:', data);
    } catch (error) {
      console.error('Error handling reversed transfer:', error);
      throw error;
    }
  }

  // Initialize payment
  static async initializePayment(
    email: string,
    amount: number,
    reference: string,
    metadata?: any
  ): Promise<any> {
    try {
      if (!this.SECRET_KEY) {
        throw new Error('Paystack secret key not configured');
      }

      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: amount * 100, // Convert to kobo
          reference,
          metadata
        }),
      });

      const data: any = await response.json();
      
      if (!data.status) {
        throw new Error(data.message || 'Payment initialization failed');
      }

      return data.data;
    } catch (error) {
      console.error('Paystack initialization error:', error);
      throw error;
    }
  }

  // Verify payment
  static async verifyPayment(reference: string): Promise<any> {
    try {
      if (!this.SECRET_KEY) {
        throw new Error('Paystack secret key not configured');
      }

      const response = await fetch(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      const data: any = await response.json();
      
      if (!data.status) {
        throw new Error(data.message || 'Payment verification failed');
      }

      return data.data;
    } catch (error) {
      console.error('Paystack verification error:', error);
      throw error;
    }
  }
}

export default PaystackService;
