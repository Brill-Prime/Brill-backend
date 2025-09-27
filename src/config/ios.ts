
export const iosConfig = {
  // iOS Firebase Configuration
  firebase: {
    bundleId: process.env.IOS_BUNDLE_ID || 'com.brillprime.mobile',
    appStoreId: process.env.IOS_APP_STORE_ID,
    teamId: process.env.IOS_TEAM_ID,
    
    // Deep linking configuration
    urlSchemes: ['brillprime', 'com.brillprime.mobile'],
    
    // Universal Links
    associatedDomains: [
      `applinks:${process.env.UNIVERSAL_LINKS_DOMAIN || 'brillprime.com'}`
    ],
    
    // Push notification entitlements
    pushNotifications: {
      enabled: true,
      development: process.env.NODE_ENV !== 'production',
      production: process.env.NODE_ENV === 'production'
    }
  },
  
  // API endpoints for iOS app
  apiEndpoints: {
    base: process.env.API_BASE_URL || 'https://your-repl-name.replit.app',
    auth: '/api/firebase/auth',
    mobile: '/api/mobile',
    transactions: '/api/transactions',
    orders: '/api/orders'
  },
  
  // iOS-specific features
  features: {
    biometricAuth: true,
    backgroundAppRefresh: true,
    locationServices: true,
    pushNotifications: true,
    offlineSupport: true
  }
};

export default iosConfig;
