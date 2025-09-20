import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

if (!GMAIL_USER || !GMAIL_PASS) {
  throw new Error('GMAIL_USER and GMAIL_PASS must be set in environment variables');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

export async function sendOTPEmail(to: string, otp: string, name?: string): Promise<boolean> {
  const mailOptions = {
    from: `BrillPrime <${GMAIL_USER}>`,
    to,
    subject: 'Your BrillPrime OTP Code',
    html: `<p>Hello${name ? ' ' + name : ''},</p><p>Your OTP code is: <b>${otp}</b></p><p>This code will expire in 10 minutes.</p>`
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send OTP email:', error);
    return false;
  }
}
