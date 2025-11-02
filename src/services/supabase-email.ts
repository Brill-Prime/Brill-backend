import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Prefer explicit EMAIL_* env vars (already set in .env), then SUPABASE_SMTP_* as fallback
const SMTP_HOST = process.env.EMAIL_HOST || process.env.SUPABASE_SMTP_HOST || process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.EMAIL_PORT || process.env.SUPABASE_SMTP_PORT || process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.EMAIL_USER || process.env.SUPABASE_SMTP_USER || process.env.SMTP_USER || process.env.GMAIL_USER;
const SMTP_PASS = process.env.EMAIL_PASS || process.env.SUPABASE_SMTP_PASS || process.env.SMTP_PASS || process.env.GMAIL_PASS;
const SENDER_EMAIL = process.env.EMAIL_FROM || process.env.SUPABASE_SENDER_EMAIL || process.env.GMAIL_USER || 'noreply@brillprime.com';

let transporter: nodemailer.Transporter | null = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  const secure = SMTP_PORT === 465;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  console.log('✅ Supabase/SMTP transporter configured for email sending');
} else {
  console.warn('⚠️ SMTP not configured: set SUPABASE_SMTP_* or EMAIL_* env vars to enable outgoing mail');
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

class SupabaseEmailService {
  static async sendEmail(
    to: string | string[],
    subject: string,
    html: string,
  ): Promise<EmailResult> {
    try {
      const recipients = Array.isArray(to) ? to : [to];

      if (!transporter) {
        console.warn('Email service not available - SMTP transporter not configured');
        return { success: false, error: 'SMTP not configured' };
      }

      const info = await transporter.sendMail({
        from: SENDER_EMAIL,
        to: recipients.join(', '),
        subject,
        html,
      });

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      console.error('Failed to send email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

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
          <p>If you have any questions, our support team is here to help.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>&copy; 2024 BrillPrime. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail(to, 'Welcome to BrillPrime!', html);
  }

  static async sendOTPEmail(
    to: string,
    otp: string,
    name?: string
  ): Promise<EmailResult> {
    const html = `
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

    return this.sendEmail(to, 'Your BrillPrime OTP Code', html);
  }

  static async sendPasswordResetEmail(
    to: string,
    name: string,
    resetToken: string
  ): Promise<EmailResult> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #e74c3c; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Password Reset</h1>
        </div>
        <div style="padding: 30px;">
          <h2>Hello ${name},</h2>
          <p>We received a request to reset your password for your BrillPrime account.</p>
          <div style="text-align: center; margin: 30px 0;">
            <p>Click the button below to reset your password:</p>
            <a href="${process.env.FRONTEND_URL}/reset-password?token=${resetToken}" 
               style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
              Reset Password
            </a>
          </div>
          <p>If you didn't request this password reset, you can safely ignore this email.</p>
          <p>This link will expire in 15 minutes.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d;">
          <p>&copy; 2024 BrillPrime. All rights reserved.</p>
        </div>
      </div>
    `;

    return this.sendEmail(to, 'Reset Your Password', html);
  }
}

export default SupabaseEmailService;