import nodemailer from 'nodemailer';
import { getUncachableGmailClient, getGmailUserEmail } from './gmail-client';

// Prefer EMAIL_* env vars from .env, fall back to older names for compatibility
// Also support Supabase SMTP env vars (SUPABASE_SMTP_*) when configured
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_HOST = process.env.EMAIL_HOST || process.env.SUPABASE_SMTP_HOST || process.env.SMTP_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT || process.env.SUPABASE_SMTP_PORT || process.env.SMTP_PORT;
const EMAIL_USER = process.env.EMAIL_USER || process.env.SUPABASE_SMTP_USER || process.env.SMTP_USER || process.env.GMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS || process.env.SUPABASE_SMTP_PASS || process.env.SMTP_PASS || process.env.GMAIL_PASS;
const EMAIL_SECURE = process.env.EMAIL_SECURE; // optional, 'true' or 'false'

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

// Check if Gmail OAuth is available (Replit integration)
let gmailOAuthEnabled = false;
let gmailUserEmail = '';

// Check environment variables - email service is optional for development
const emailEnabled = (EMAIL_USER && EMAIL_PASS) || (process.env.GMAIL_USER && process.env.GMAIL_PASS);

async function initializeGmailOAuth() {
  try {
    await getUncachableGmailClient();
    gmailUserEmail = await getGmailUserEmail();
    gmailOAuthEnabled = true;
    console.log('✅ Gmail OAuth enabled for email notifications');
  } catch (error) {
    gmailOAuthEnabled = false;
  }
}

// Initialize Gmail OAuth on startup
initializeGmailOAuth().then(() => {
  if (!emailEnabled && !gmailOAuthEnabled) {
    console.warn('⚠️ Email service disabled: No email credentials or OAuth configured');
  } else if (gmailOAuthEnabled) {
    console.log('✅ Email service enabled via Gmail OAuth');
  } else if (emailEnabled) {
    console.log('✅ Email service enabled via SMTP');
  }
});

const transporter = emailEnabled ? (() => {
  // If explicit SMTP/EMAIL host provided, use it
  if (EMAIL_HOST) {
    const port = parseInt(EMAIL_PORT || '587');
    const secure = EMAIL_SECURE ? EMAIL_SECURE === 'true' : (port === 465);
    return nodemailer.createTransport({
      host: EMAIL_HOST,
      port,
      secure,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });
  }

  // Fallback to Gmail SMTP using user/pass
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });
  }

  return null;
})() : null;

class EmailService {
  // Base email sending function
  static async sendEmail(
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
    attachments?: any[]
  ): Promise<EmailResult> {
    // Try Gmail OAuth first (Replit integration)
    if (gmailOAuthEnabled) {
      try {
        return await this.sendEmailViaGmailAPI(to, subject, html, text);
      } catch (error: any) {
        console.error('Gmail OAuth send failed, falling back to SMTP:', error);
        gmailOAuthEnabled = false;
      }
    }

    // Fallback to SMTP
    if (!emailEnabled || !transporter) {
      console.warn('Email service not available - email not sent');
      return {
        success: false,
        error: 'Email service not configured'
      };
    }

    const fromEmail = EMAIL_FROM || EMAIL_USER || process.env.GMAIL_USER || 'noreply@brillprime.com';
    const mailOptions = {
      from: `${fromEmail.startsWith('"') ? fromEmail : 'BrillPrime <' + fromEmail + '>'}`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text,
      attachments
    };

    try {
      const result = await transporter.sendMail(mailOptions);
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error: any) {
      console.error('Failed to send email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send email via Gmail API (OAuth)
  private static async sendEmailViaGmailAPI(
    to: string | string[],
    subject: string,
    html: string,
    text?: string
  ): Promise<EmailResult> {
    try {
      const gmail = await getUncachableGmailClient();
      const recipients = Array.isArray(to) ? to.join(', ') : to;
      const fromEmail = gmailUserEmail || 'noreply@brillprime.com';

      const message = [
        `From: BrillPrime <${fromEmail}>`,
        `To: ${recipients}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        html
      ].join('\n');

      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      return {
        success: true,
        messageId: result.data.id || undefined
      };
    } catch (error: any) {
      console.error('Failed to send email via Gmail API:', error);
      throw error;
    }
  }

  // OTP Email
  static async sendOTPEmail(
    to: string,
    otp: string,
    name?: string,
    subject?: string,
    htmlContent?: string
  ): Promise<EmailResult> {
    const defaultSubject = 'Your BrillPrime OTP Code';
    const defaultHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="color: #2c3e50;">BrillPrime</h1>
        </div>
        <div style="padding: 30px;">
          <h2>Verification Code</h2>
          <p>Hello${name ? ' ' + name : ''},</p>
          <p>Your verification code is:</p>
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; color: #2c3e50; letter-spacing: 5px;">${otp}</span>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>&copy; 2024 BrillPrime. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail(to, subject || defaultSubject, htmlContent || defaultHtml);
  }

  // Welcome Email
  static async sendWelcomeEmail(to: string, name: string): Promise<EmailResult> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #2c3e50; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Welcome to BrillPrime!</h1>
        </div>
        <div style="padding: 30px;">
          <h2>Hello ${name}!</h2>
          <p>Welcome to BrillPrime - your premier delivery and logistics platform.</p>
          <p>We're excited to have you on board. You can now:</p>
          <ul>
            <li>Order products from verified merchants</li>
            <li>Track your deliveries in real-time</li>
            <li>Earn rewards on every purchase</li>
            <li>Connect with trusted drivers</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || '#'}" style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Get Started</a>
          </div>
          <p>If you have any questions, our support team is here to help.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>&copy; 2024 BrillPrime. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail(to, 'Welcome to BrillPrime!', html);
  }

  // Order Confirmation Email
  static async sendOrderConfirmationEmail(
    to: string,
    orderNumber: string,
    customerName: string,
    amount: number,
    items: any[]
  ): Promise<EmailResult> {
    const itemsHtml = items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₦${item.price.toLocaleString()}</td>
      </tr>
    `).join('');

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #27ae60; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Order Confirmed!</h1>
        </div>
        <div style="padding: 30px;">
          <h2>Thank you for your order, ${customerName}!</h2>
          <p>Your order has been confirmed and is being processed.</p>

          <div style="background-color: #f8f9fa; padding: 20px; margin: 20px 0;">
            <h3>Order Details</h3>
            <p><strong>Order Number:</strong> ${orderNumber}</p>
            <p><strong>Total Amount:</strong> ₦${amount.toLocaleString()}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Item</th>
                <th style="padding: 10px; text-align: center; border-bottom: 2px solid #ddd;">Qty</th>
                <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <p>You will receive updates on your order status via SMS and email.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>&copy; 2024 BrillPrime. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail(to, `Order Confirmation - ${orderNumber}`, html);
  }

  // Password Reset Email
  static async sendPasswordResetEmail(
    to: string,
    name: string,
    resetToken: string
  ): Promise<EmailResult> {
    const resetUrl = `${process.env.FRONTEND_URL || ''}/reset-password?token=${resetToken}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #e74c3c; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Password Reset</h1>
        </div>
        <div style="padding: 30px;">
          <h2>Hello ${name},</h2>
          <p>We received a request to reset your password for your BrillPrime account.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #e74c3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">Reset Password</a>
          </div>
          <p>If you didn't request this password reset, please ignore this email.</p>
          <p>This link will expire in 1 hour for security reasons.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>&copy; 2024 BrillPrime. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail(to, 'Reset Your Password', html);
  }

  // Bulk email sending
  static async sendBulkEmail(
    recipients: string[],
    subject: string,
    html: string,
    text?: string
  ): Promise<{ success: number; failed: number; results: EmailResult[] }> {
    const results: EmailResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      const result = await this.sendEmail(recipient, subject, html, text);
      results.push(result);

      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return {
      success: successCount,
      failed: failedCount,
      results
    };
  }
}

// Backward compatibility
export async function sendOTPEmail(
  to: string,
  otp: string,
  name?: string,
  subject?: string,
  htmlContent?: string
): Promise<boolean> {
  const result = await EmailService.sendOTPEmail(to, otp, name, subject, htmlContent);
  return result.success;
}

export default EmailService;