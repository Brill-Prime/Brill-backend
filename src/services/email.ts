import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// Check environment variables - email service is optional for development
const emailEnabled = GMAIL_USER && GMAIL_PASS;

if (!emailEnabled) {
  console.warn('⚠️ Email service disabled: GMAIL_USER and GMAIL_PASS not set');
}

const transporter = emailEnabled ? nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
}) : null;

export async function sendOTPEmail(
  to: string, 
  otp: string, 
  name?: string, 
  subject?: string, 
  htmlContent?: string
): Promise<boolean> {
  if (!emailEnabled || !transporter) {
    console.warn('Email service not available - OTP email not sent');
    return false;
  }

  const defaultSubject = 'Your BrillPrime OTP Code';
  const defaultHtml = `<p>Hello${name ? ' ' + name : ''},</p><p>Your OTP code is: <b>${otp}</b></p><p>This code will expire in 10 minutes.</p>`;

  const mailOptions = {
    from: `BrillPrime <${GMAIL_USER}>`,
    to,
    subject: subject || defaultSubject,
    html: htmlContent || defaultHtml
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send OTP email:', error);
    return false;
  }
}