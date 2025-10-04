
import { getMessaging, getToken } from 'firebase-admin/messaging';
import { adminApp } from '../config/firebase-admin';

/**
 * Requests permission to send push notifications and returns the device token.
 *
 * @returns The device token, or null if permission is denied.
 */
export const requestPermission = async () => {
  const messaging = getMessaging(adminApp);
  // const permission = await Notification.requestPermission(); // This is a browser API
  const permission = 'granted'; // Placeholder

  if (permission === 'granted') {
    // const token = await getToken(messaging); // This is not how you get a token in the backend
    return null;
  }

  return null;
};
