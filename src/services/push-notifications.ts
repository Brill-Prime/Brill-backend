
import { getMessaging, getToken } from 'firebase/messaging';
import app from '../config/firebase';

/**
 * Requests permission to send push notifications and returns the device token.
 *
 * @returns The device token, or null if permission is denied.
 */
export const requestPermission = async () => {
  const messaging = getMessaging(app);
  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    const token = await getToken(messaging);
    return token;
  }

  return null;
};
