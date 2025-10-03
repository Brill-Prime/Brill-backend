
import { Resend } from 'resend';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const emailSchema = z.object({
  to: z.string().email(),
  from: z.string().email(),
  subject: z.string(),
  html: z.string(),
});

class ResendEmailService {
  static async sendEmail(to: string, subject: string, html: string) {
    try {
      const { data, error } = await resend.emails.send({
        from: 'BrillPrime <hello@brillprime.com>',
        to,
        subject,
        html,
      });

      if (error) {
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error };
    }
  }

  static async sendWelcomeEmail(to: string, name: string) {
    const subject = 'Welcome to BrillPrime!';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Welcome to BrillPrime</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          h1 {
            color: #333333;
          }
          p {
            color: #555555;
          }
          .button {
            display: inline-block;
            background-color: #3498db;
            color: #ffffff;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 3px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Welcome, ${name}!</h1>
          <p>We're thrilled to have you at BrillPrime.</p>
          <a href="${process.env.FRONTEND_URL || '#'}" class="button">Get Started</a>
        </div>
      </body>
      </html>
    `;
    return this.sendEmail(to, subject, html);
  }
}

export default ResendEmailService;
