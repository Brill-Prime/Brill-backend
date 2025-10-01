
import { Twilio } from 'twilio';

interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

class SMSService {
  private static twilioClient: Twilio | null = null;
  private static readonly TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  private static readonly TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  private static readonly TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

  // Initialize Twilio client
  private static getTwilioClient(): Twilio | null {
    if (!this.TWILIO_ACCOUNT_SID || !this.TWILIO_AUTH_TOKEN) {
      console.warn('Twilio credentials not configured');
      return null;
    }

    if (!this.twilioClient) {
      this.twilioClient = new Twilio(this.TWILIO_ACCOUNT_SID, this.TWILIO_AUTH_TOKEN);
    }

    return this.twilioClient;
  }

  // Send SMS
  static async sendSMS(to: string, message: string): Promise<SMSResult> {
    try {
      const client = this.getTwilioClient();
      
      if (!client || !this.TWILIO_PHONE_NUMBER) {
        console.warn('SMS service not available - Twilio not configured');
        return {
          success: false,
          error: 'SMS service not configured'
        };
      }

      // Format phone number (ensure it starts with +)
      const formattedTo = to.startsWith('+') ? to : `+234${to.replace(/^0/, '')}`;

      const result = await client.messages.create({
        body: message,
        from: this.TWILIO_PHONE_NUMBER,
        to: formattedTo
      });

      return {
        success: true,
        messageId: result.sid
      };
    } catch (error: any) {
      console.error('SMS sending error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send OTP SMS
  static async sendOTP(phoneNumber: string, otp: string, name?: string): Promise<SMSResult> {
    const message = `Hello${name ? ' ' + name : ''}, your BrillPrime verification code is: ${otp}. This code expires in 10 minutes.`;
    
    return this.sendSMS(phoneNumber, message);
  }

  // Send order notification SMS
  static async sendOrderNotification(
    phoneNumber: string, 
    orderNumber: string, 
    status: string,
    customerName?: string
  ): Promise<SMSResult> {
    const message = `Hi${customerName ? ' ' + customerName : ''}, your order ${orderNumber} status has been updated to: ${status}. Track your order on BrillPrime app.`;
    
    return this.sendSMS(phoneNumber, message);
  }

  // Send delivery notification SMS
  static async sendDeliveryNotification(
    phoneNumber: string,
    orderNumber: string,
    driverName: string,
    driverPhone: string
  ): Promise<SMSResult> {
    const message = `Your order ${orderNumber} is out for delivery! Driver: ${driverName}, Contact: ${driverPhone}. Track live on BrillPrime app.`;
    
    return this.sendSMS(phoneNumber, message);
  }

  // Send payment confirmation SMS
  static async sendPaymentConfirmation(
    phoneNumber: string,
    amount: number,
    reference: string,
    customerName?: string
  ): Promise<SMSResult> {
    const message = `Hi${customerName ? ' ' + customerName : ''}, your payment of ₦${amount.toLocaleString()} has been confirmed. Reference: ${reference}. Thank you for using BrillPrime!`;
    
    return this.sendSMS(phoneNumber, message);
  }

  // Bulk SMS sending
  static async sendBulkSMS(
    phoneNumbers: string[],
    message: string
  ): Promise<{ success: number; failed: number; results: SMSResult[] }> {
    const results: SMSResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const phoneNumber of phoneNumbers) {
      const result = await this.sendSMS(phoneNumber, message);
      results.push(result);
      
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      success: successCount,
      failed: failedCount,
      results
    };
  }

  // Get SMS delivery status
  static async getSMSStatus(messageId: string): Promise<any> {
    try {
      const client = this.getTwilioClient();
      
      if (!client) {
        return null;
      }

      const message = await client.messages(messageId).fetch();
      
      return {
        sid: message.sid,
        status: message.status,
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        dateUpdated: message.dateUpdated,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage
      };
    } catch (error) {
      console.error('SMS status check error:', error);
      return null;
    }
  }
}

export default SMSService;
