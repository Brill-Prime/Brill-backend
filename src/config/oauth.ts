
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID, // Replace with your Google Client ID
  process.env.GOOGLE_CLIENT_SECRET, // Replace with your Google Client Secret
  process.env.GOOGLE_REDIRECT_URI // Replace with your Google Redirect URI
);

export { oauth2Client };