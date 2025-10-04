import crypto from 'crypto';
import { db } from '../db/config';
import { transactions, orders, auditLogs, escrows } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';

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
      const existingMetadata = transaction.metadata as Record<string, any> | null;
      const metadata = (typeof existingMetadata === 'object' && existingMetadata !== null) ? existingMetadata : {};
      
      const updatedTransaction = await db
        .update(transactions)
        .set({
          status: 'COMPLETED',
          paymentGatewayRef: data.reference,
          paystackTransactionId: data.id.toString(),
          completedAt: new Date(data.paid_at || data.created_at),
          metadata: {
            ...metadata,
            paystack: data,
            completedVia: 'webhook'
          } as any
        })
        .where(eq(transactions.id, transaction.id))
        .returning();

      // Update associated order and create escrow if exists
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
            .where(eq(orders.id, transaction.orderId));

          // Create escrow to hold funds
          const existingEscrow = await db
            .select()
            .from(escrows)
            .where(and(
              eq(escrows.orderId, order.id),
              isNull(escrows.deletedAt)
            ))
            .limit(1);

          if (!existingEscrow.length) {
            await db.insert(escrows).values({
              orderId: order.id,
              payerId: order.customerId,
              payeeId: order.merchantId!,
              amount: transaction.amount,
              status: 'HELD',
              paystackEscrowId: data.reference,
              transactionRef: transaction.transactionRef,
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

      const existingMetadata = transaction.metadata as Record<string, any> | null;
      const metadata = (typeof existingMetadata === 'object' && existingMetadata !== null) ? existingMetadata : {};
      
      await db
        .update(transactions)
        .set({
          status: 'FAILED',
          paymentGatewayRef: data.reference,
          paystackTransactionId: data.id.toString(),
          metadata: {
            ...metadata,
            paystack: data,
            failureReason: data.gateway_response || 'Payment failed',
            failedAt: new Date().toISOString()
          } as any
        })
        .where(eq(transactions.id, transaction.id));
      
      // Update associated order to failed if exists
      if (transaction.orderId) {
        await db
          .update(orders)
          .set({
            status: 'CANCELLED',
            updatedAt: new Date()
          })
          .where(eq(orders.id, transaction.orderId));
      }

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
      const { reference } = data;

      // Update transaction status for transfers
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

        // Log audit event
        await db.insert(auditLogs).values({
          userId: transaction.userId,
          action: 'TRANSFER_SUCCESS',
          entityType: 'TRANSACTION',
          entityId: transaction.id,
          details: {
            reference: data.reference,
            transferCode: data.transfer_code
          }
        });
      }

      console.log('Transfer successful:', reference);
    } catch (error) {
      console.error('Error handling successful transfer:', error);
      throw error;
    }
  }

  // Handle failed transfer
  private static async handleFailedTransfer(data: any): Promise<void> {
    try {
      const { reference } = data;

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

        // Log audit event
        await db.insert(auditLogs).values({
          userId: transaction.userId,
          action: 'TRANSFER_FAILED',
          entityType: 'TRANSACTION',
          entityId: transaction.id,
          details: {
            reference: data.reference,
            reason: data.message
          }
        });
      }

      console.log('Transfer failed:', reference);
    } catch (error) {
      console.error('Error handling failed transfer:', error);
      throw error;
    }
  }

  // Handle reversed transfer
  private static async handleReversedTransfer(data: any): Promise<void> {
    try {
      const { reference } = data;

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

        // Log audit event
        await db.insert(auditLogs).values({
          userId: transaction.userId,
          action: 'TRANSFER_REVERSED',
          entityType: 'TRANSACTION',
          entityId: transaction.id,
          details: {
            reference: data.reference
          }
        });
      }

      console.log('Transfer reversed:', reference);
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

      const data = await response.json() as { status: boolean; message?: string; data?: any };

      if (!data.status) {
        throw new Error(data.message || 'Payment initialization failed');
      }

      return data.data;
    } catch (error) {
      console.error('Paystack initialization error:', error);
      throw error;
    }
  }

  // Create transfer recipient
  static async createTransferRecipient(data: {
    type: string;
    name: string;
    account_number: string;
    bank_code: string;
    currency?: string;
    description?: string;
  }): Promise<{ success: boolean; recipient_code?: string; error?: string }> {
    try {
      if (!this.SECRET_KEY) {
        throw new Error('Paystack secret key not configured');
      }

      const response = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          currency: data.currency || 'NGN'
        }),
      });

      const result = await response.json() as { status: boolean; message?: string; data?: { recipient_code: string } };

      if (!result.status) {
        return { success: false, error: result.message || 'Failed to create recipient' };
      }

      return { success: true, recipient_code: result.data?.recipient_code };
    } catch (error) {
      console.error('Create recipient error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Initiate transfer
  static async initiateTransfer(data: {
    source: string;
    amount: number;
    recipient: string;
    reason?: string;
    reference?: string;
  }): Promise<{ status: boolean; message?: string; data?: any }> {
    try {
      if (!this.SECRET_KEY) {
        throw new Error('Paystack secret key not configured');
      }

      const response = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      return await response.json() as { status: boolean; message?: string; data?: any };
    } catch (error) {
      console.error('Initiate transfer error:', error);
      return { status: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Get banks
  static async getBanks(country: string = 'nigeria'): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      if (!this.SECRET_KEY) {
        throw new Error('Paystack secret key not configured');
      }

      const response = await fetch(`https://api.paystack.co/bank?country=${country}`, {
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
        },
      });

      const result = await response.json() as { status: boolean; message?: string; data?: any[] };

      if (!result.status) {
        return { success: false, error: result.message || 'Failed to fetch banks' };
      }

      return { success: true, data: result.data };
    } catch (error) {
      console.error('Get banks error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Resolve account number
  static async resolveAccountNumber(accountNumber: string, bankCode: string): Promise<{ success: boolean; account_name?: string; account_number?: string; error?: string }> {
    try {
      if (!this.SECRET_KEY) {
        throw new Error('Paystack secret key not configured');
      }

      const response = await fetch(
        `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      const result = await response.json() as { status: boolean; message?: string; data?: { account_name: string; account_number: string } };

      if (!result.status) {
        return { success: false, error: result.message || 'Failed to resolve account' };
      }

      return { 
        success: true, 
        account_name: result.data?.account_name,
        account_number: result.data?.account_number
      };
    } catch (error) {
      console.error('Resolve account error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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

      const data = await response.json() as { status: boolean; message?: string; data?: any };

      if (!data.status) {
        throw new Error(data.message || 'Payment verification failed');
      }

      return data.data;
    } catch (error) {
      console.error('Paystack verification error:', error);
      throw error;
    }
  }

  // Initialize transaction wrapper
  static async initializeTransaction(email: string, amount: number, metadata?: any) {
    try {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PaystackService.SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          amount: Math.round(amount * 100), // Convert to kobo
          metadata,
          callback_url: process.env.PAYSTACK_CALLBACK_URL
        })
      });

      const result = await response.json() as { status: boolean; message?: string; data?: any };

      if (!result.status) {
        throw new Error(result.message || 'Transaction initialization failed');
      }

      return {
        status: true,
        data: result.data,
        authorization_url: result.data.authorization_url,
        access_code: result.data.access_code,
        reference: result.data.reference
      };
    } catch (error) {
      console.error('Transaction initialization error:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Verify transaction wrapper
  static async verifyTransaction(reference: string) {
    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          'Authorization': `Bearer ${PaystackService.SECRET_KEY}`
        }
      });

      const result = await response.json() as { status: boolean; message?: string; data?: any };

      if (!result.status) {
        throw new Error(result.message || 'Transaction verification failed');
      }

      return {
        status: true,
        data: result.data,
        amount: result.data.amount,
        reference: result.data.reference,
        paid_at: result.data.paid_at,
        customer: result.data.customer
      };
    } catch (error) {
      console.error('Transaction verification error:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export default PaystackService;