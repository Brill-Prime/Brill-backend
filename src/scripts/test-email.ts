import SupabaseEmailService from '../services/supabase-email';

async function testEmail() {
    try {
        const result = await SupabaseEmailService.sendEmail(
            'brillprimeltd@gmail.com',
            'Test Email',
            '<h1>Test Email</h1><p>This is a test email to verify the Supabase SMTP email service is working.</p>'
        );
        console.log('Email result:', result);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

testEmail();