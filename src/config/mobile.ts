
export const mobileConfig = {
  // iOS Configuration
  ios: {
    bundleId: process.env.IOS_BUNDLE_ID || 'com.brillprime.mobile',
    appStoreId: process.env.IOS_APP_STORE_ID,
    teamId: process.env.IOS_TEAM_ID,
    universalLinks: {
      domain: process.env.UNIVERSAL_LINKS_DOMAIN || 'brillprime.com',
      paths: ['/app/*', '/order/*', '/driver/*']
    }
  },
  
  // Android Configuration
  android: {
    packageName: 'com.brillprime',
    applicationId: '1:1064268711919:android:6e148568cf68476fa2581a',
    apiKey: 'AIzaSyAqseqstCc-Tx807Hsr_6LXIJbInHY7xUo',
    projectNumber: '1064268711919',
    sha256CertFingerprint: process.env.ANDROID_SHA256_CERT_FINGERPRINT,
    playStoreId: process.env.ANDROID_PLAY_STORE_ID,
    deepLinks: {
      scheme: 'brillprime',
      host: 'app',
      intentFilters: [
        'android.intent.action.VIEW',
        'android.intent.category.DEFAULT',
        'android.intent.category.BROWSABLE'
      ]
    }
  },
  
  // Common Mobile Settings
  common: {
    apiVersion: 'v1',
    supportedVersions: {
      minimum: '1.0.0',
      recommended: '1.2.0'
    },
    features: {
      offlineSupport: true,
      pushNotifications: true,
      biometricAuth: true,
      locationServices: true
    }
  },
  
  // Push Notification Settings
  pushNotifications: {
    enabled: true,
    topics: ['orders', 'delivery', 'promotions', 'system'],
    priorities: {
      high: ['delivery_assigned', 'order_completed'],
      normal: ['order_placed', 'promotion'],
      low: ['system_maintenance']
    }
  }
};

export default mobileConfig;
