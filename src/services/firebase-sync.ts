import { adminRealtimeDb, adminDb as adminFirestore, adminAuth } from '../config/firebase-admin';
import { db } from '../db/config';
import { users, driverProfiles, merchantProfiles } from '../db/schema';
import { eq } from 'drizzle-orm';

interface LocationUpdate {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

interface UserData {
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  photoURL?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  metadata?: {
    lastSignInTime?: string;
    creationTime?: string;
  };
}

class FirebaseSyncService {
  private isInitialized = false;
  private syncListeners: (() => void)[] = [];

  async initialize() {
    if (this.isInitialized) {
      console.log('🔄 Firebase sync already initialized');
      return;
    }

    if (!adminRealtimeDb) {
      console.warn('⚠️ Firebase Realtime Database not available - sync service disabled');
      return;
    }

    // Skip initialization in development mode if SKIP_DB_CONNECTION_TEST is true
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_DB_CONNECTION_TEST === 'true') {
      console.warn('⚠️ Skipping Firebase sync service initialization in development mode');
      this.isInitialized = true;
      return;
    }

    console.log('🔄 Initializing Firebase sync service...');

    try {
      await this.syncFirebaseAuthUsers();
      this.setupRealtimeDatabaseSync();
      this.setupFirestoreSync();
      
      this.isInitialized = true;
      console.log('✅ Firebase sync service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase sync service:', error);
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ Continuing despite Firebase sync initialization error in development mode');
        this.isInitialized = true;
      } else {
        throw error;
      }
    }
  }

  async syncFirebaseAuthUsers() {
    if (!adminAuth) {
      console.warn('⚠️ Firebase Auth not available - skipping user sync');
      return;
    }

    // Skip in development mode if SKIP_DB_CONNECTION_TEST is true
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_DB_CONNECTION_TEST === 'true') {
      console.log('⏩ Skipping Firebase Auth users sync in development mode');
      return;
    }

    console.log('🔄 Syncing Firebase Auth users to PostgreSQL...');

    try {
      let pageToken: string | undefined;
      let totalSynced = 0;

      do {
        const listUsersResult = await adminAuth.listUsers(1000, pageToken);
        
        for (const userRecord of listUsersResult.users) {
          await this.syncUserToPostgres(userRecord);
          totalSynced++;
        }

        pageToken = listUsersResult.pageToken;
      } while (pageToken);

      console.log(`✅ Synced ${totalSynced} Firebase Auth users to PostgreSQL`);
    } catch (error) {
      console.error('❌ Error syncing Firebase Auth users:', error);
      // Don't throw in development mode
      if (process.env.NODE_ENV !== 'development') {
        throw error;
      }
    }
  }

  private async syncUserToPostgres(userRecord: any) {
    try {
      const existingUser = await db.select().from(users).where(eq(users.firebaseUid, userRecord.uid)).limit(1);

      const userData = {
        firebaseUid: userRecord.uid,
        email: userRecord.email || `${userRecord.uid}@placeholder.com`,
        fullName: userRecord.displayName || userRecord.email?.split('@')[0] || 'Unknown User',
        phone: userRecord.phoneNumber || null,
        profilePicture: userRecord.photoURL || null,
        isVerified: userRecord.emailVerified || false,
        isActive: !userRecord.disabled,
        lastLoginAt: userRecord.metadata.lastSignInTime ? new Date(userRecord.metadata.lastSignInTime) : null,
        updatedAt: new Date()
      };

      if (existingUser.length > 0) {
        await db.update(users)
          .set(userData)
          .where(eq(users.firebaseUid, userRecord.uid));
      } else {
        await db.insert(users).values(userData);
      }
    } catch (error) {
      console.error(`❌ Error syncing user ${userRecord.uid}:`, error);
    }
  }

  private setupRealtimeDatabaseSync() {
    if (!adminRealtimeDb) return;

    console.log('🔄 Setting up Firebase Realtime Database sync listeners...');

    const locationsRef = adminRealtimeDb.ref('locations/users');
    const unsubscribeLocations = locationsRef.on('child_changed', async (snapshot) => {
      const userId = snapshot.key;
      const locationData = snapshot.val() as LocationUpdate;

      if (userId && locationData) {
        await this.syncUserLocation(userId, locationData);
      }
    });
    this.syncListeners.push(() => locationsRef.off('child_changed', unsubscribeLocations));

    locationsRef.on('child_added', async (snapshot) => {
      const userId = snapshot.key;
      const locationData = snapshot.val() as LocationUpdate;

      if (userId && locationData) {
        await this.syncUserLocation(userId, locationData);
      }
    });
    this.syncListeners.push(() => locationsRef.off('child_added'));

    const usersRef = adminRealtimeDb.ref('users');
    usersRef.on('child_changed', async (snapshot) => {
      const firebaseUid = snapshot.key;
      const userData = snapshot.val() as UserData;

      if (firebaseUid && userData) {
        await this.syncRealtimeUserData(firebaseUid, userData);
      }
    });
    this.syncListeners.push(() => usersRef.off('child_changed'));

    usersRef.on('child_added', async (snapshot) => {
      const firebaseUid = snapshot.key;
      const userData = snapshot.val() as UserData;

      if (firebaseUid && userData) {
        await this.syncRealtimeUserData(firebaseUid, userData);
      }
    });
    this.syncListeners.push(() => usersRef.off('child_added'));

    console.log('✅ Realtime Database sync listeners active');
  }

  private async syncUserLocation(firebaseUid: string, locationData: LocationUpdate) {
    try {
      // Skip in development mode if SKIP_DB_CONNECTION_TEST is true
      if (process.env.NODE_ENV === 'development' && process.env.SKIP_DB_CONNECTION_TEST === 'true') {
        console.log(`⏩ Skipping location sync for ${firebaseUid} in development mode`);
        return;
      }

      const userResult = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);

      if (userResult.length === 0) {
        console.warn(`⚠️ User not found for Firebase UID: ${firebaseUid}`);
        return;
      }

      const user = userResult[0];

      if (user.role === 'DRIVER') {
        await db.update(driverProfiles)
          .set({
            currentLocation: {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              timestamp: locationData.timestamp,
              accuracy: locationData.accuracy,
              heading: locationData.heading,
              speed: locationData.speed
            },
            updatedAt: new Date()
          })
          .where(eq(driverProfiles.userId, user.id));

        console.log(`✅ Synced location for driver ${firebaseUid}`);
      } else if (user.role === 'MERCHANT') {
        await db.update(merchantProfiles)
          .set({
            latitude: locationData.latitude.toString(),
            longitude: locationData.longitude.toString(),
            updatedAt: new Date()
          })
          .where(eq(merchantProfiles.userId, user.id));

        console.log(`✅ Synced location for merchant ${firebaseUid}`);
      }
    } catch (error) {
      console.error(`❌ Error syncing location for user ${firebaseUid}:`, error);
      // Don't throw in development mode
      if (process.env.NODE_ENV !== 'development') {
        throw error;
      }
    }
  }

  private async syncRealtimeUserData(firebaseUid: string, userData: UserData) {
    try {
      const existingUser = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);

      const updateData: any = {
        updatedAt: new Date()
      };

      if (userData.email) updateData.email = userData.email;
      if (userData.displayName) updateData.fullName = userData.displayName;
      if (userData.phoneNumber) updateData.phone = userData.phoneNumber;
      if (userData.photoURL) updateData.profilePicture = userData.photoURL;
      if (typeof userData.emailVerified === 'boolean') updateData.isVerified = userData.emailVerified;
      if (typeof userData.disabled === 'boolean') updateData.isActive = !userData.disabled;
      if (userData.metadata?.lastSignInTime) {
        updateData.lastLoginAt = new Date(userData.metadata.lastSignInTime);
      }

      if (existingUser.length > 0) {
        await db.update(users)
          .set(updateData)
          .where(eq(users.firebaseUid, firebaseUid));
        
        console.log(`✅ Synced realtime user data for ${firebaseUid}`);
      } else {
        await db.insert(users).values({
          firebaseUid,
          email: userData.email || `${firebaseUid}@placeholder.com`,
          fullName: userData.displayName || 'Unknown User',
          phone: userData.phoneNumber || null,
          profilePicture: userData.photoURL || null,
          isVerified: userData.emailVerified || false,
          isActive: !(userData.disabled || false)
        });
        
        console.log(`✅ Created new user from realtime data: ${firebaseUid}`);
      }
    } catch (error) {
      console.error(`❌ Error syncing realtime user data for ${firebaseUid}:`, error);
    }
  }

  private setupFirestoreSync() {
    if (!adminFirestore) {
      console.log('⚠️ Firestore not available - skipping Firestore sync');
      return;
    }

    console.log('🔄 Setting up Firestore sync listeners...');

    const usersCollection = adminFirestore.collection('users');
    const unsubscribe = usersCollection.onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const firebaseUid = change.doc.id;
        const userData = change.doc.data();

        if (change.type === 'added' || change.type === 'modified') {
          await this.syncFirestoreUserData(firebaseUid, userData);
        }
      }
    });

    this.syncListeners.push(unsubscribe);
    console.log('✅ Firestore sync listeners active');
  }

  private async syncFirestoreUserData(firebaseUid: string, userData: any) {
    try {
      const existingUser = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);

      const updateData: any = {
        updatedAt: new Date()
      };

      if (userData.email) updateData.email = userData.email;
      if (userData.name || userData.displayName || userData.fullName) {
        updateData.fullName = userData.name || userData.displayName || userData.fullName;
      }
      if (userData.phone || userData.phoneNumber) {
        updateData.phone = userData.phone || userData.phoneNumber;
      }
      if (userData.photoURL || userData.profilePicture) {
        updateData.profilePicture = userData.photoURL || userData.profilePicture;
      }
      if (typeof userData.emailVerified === 'boolean') {
        updateData.isVerified = userData.emailVerified;
      }
      if (typeof userData.isActive === 'boolean') {
        updateData.isActive = userData.isActive;
      }
      if (userData.role) {
        const validRoles = ['CONSUMER', 'MERCHANT', 'DRIVER', 'ADMIN'];
        if (validRoles.includes(userData.role.toUpperCase())) {
          updateData.role = userData.role.toUpperCase();
        }
      }

      if (existingUser.length > 0) {
        await db.update(users)
          .set(updateData)
          .where(eq(users.firebaseUid, firebaseUid));
        
        console.log(`✅ Synced Firestore user data for ${firebaseUid}`);
      } else {
        await db.insert(users).values({
          firebaseUid,
          email: userData.email || `${firebaseUid}@placeholder.com`,
          fullName: userData.name || userData.displayName || userData.fullName || 'Unknown User',
          phone: userData.phone || userData.phoneNumber || null,
          profilePicture: userData.photoURL || userData.profilePicture || null,
          isVerified: userData.emailVerified || false,
          isActive: userData.isActive !== false,
          role: userData.role?.toUpperCase() || 'CONSUMER'
        });
        
        console.log(`✅ Created new user from Firestore: ${firebaseUid}`);
      }
    } catch (error) {
      console.error(`❌ Error syncing Firestore user data for ${firebaseUid}:`, error);
    }
  }

  async manualSync() {
    console.log('🔄 Starting manual Firebase sync...');
    
    await this.syncFirebaseAuthUsers();
    
    if (adminRealtimeDb) {
      const locationsSnapshot = await adminRealtimeDb.ref('locations/users').once('value');
      const locationsData = locationsSnapshot.val();
      
      if (locationsData) {
        for (const [userId, locationData] of Object.entries(locationsData)) {
          await this.syncUserLocation(userId, locationData as LocationUpdate);
        }
      }

      const usersSnapshot = await adminRealtimeDb.ref('users').once('value');
      const usersData = usersSnapshot.val();
      
      if (usersData) {
        for (const [firebaseUid, userData] of Object.entries(usersData)) {
          await this.syncRealtimeUserData(firebaseUid, userData as UserData);
        }
      }
    }

    if (adminFirestore) {
      const usersSnapshot = await adminFirestore.collection('users').get();
      for (const doc of usersSnapshot.docs) {
        await this.syncFirestoreUserData(doc.id, doc.data());
      }
    }

    console.log('✅ Manual Firebase sync completed');
  }

  cleanup() {
    console.log('🧹 Cleaning up Firebase sync listeners...');
    this.syncListeners.forEach(unsubscribe => unsubscribe());
    this.syncListeners = [];
    this.isInitialized = false;
    console.log('✅ Firebase sync cleanup completed');
  }
}

export const firebaseSyncService = new FirebaseSyncService();

export const startFirebaseSyncService = async () => {
  try {
    await firebaseSyncService.initialize();
  } catch (error) {
    console.error('❌ Failed to start Firebase sync service:', error);
  }
};

export const runManualFirebaseSync = async () => {
  try {
    await firebaseSyncService.manualSync();
  } catch (error) {
    console.error('❌ Failed to run manual Firebase sync:', error);
  }
};

export default firebaseSyncService;
