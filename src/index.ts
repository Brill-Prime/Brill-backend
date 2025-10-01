import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import authRouter from './routes/auth';
import userRouter from './routes/users';
import categoriesRouter from './routes/categories';
import productsRouter from './routes/products';
import ordersRouter from './routes/orders';
import escrowsRouter from './routes/escrows';
import transactionsRouter from './routes/transactions';
import driversRouter from './routes/drivers';
import merchantsRouter from './routes/merchants';
import fuelOrdersRouter from './routes/fuel-orders';
import ratingsRouter from './routes/ratings';
import deliveryFeedbackRouter from './routes/delivery-feedback';
import supportTicketsRouter from './routes/support-tickets';
import auditLogsRouter from './routes/audit-logs';
import trackingRouter from './routes/tracking';
import fraudAlertsRouter from './routes/fraud-alerts';
import messagesRouter from './routes/messages';
import contentReportsRouter from './routes/content-reports';
import moderationResponsesRouter from './routes/moderation-responses';
import firebaseRouter from './routes/firebase';
import mobileRouter from './routes/mobile';
import iosRoutes from './routes/ios';
import androidRoutes from './routes/android';
import webRoutes from './routes/web';
import { testConnection, db } from './db/config';
import { users } from './db/schema';

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// Middleware
// CORS middleware
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// Security middleware
if (process.env.NODE_ENV === 'production') {
  app.use(helmet());
}

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware (required for auth)
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'strict'
  }
}));

// Auth routes
app.use('/auth', authRouter);

// User management routes
app.use('/api/users', userRouter);

// Categories management routes
app.use('/api/categories', categoriesRouter);

// Products management routes
app.use('/api/products', productsRouter);

// Orders management routes
app.use('/api/orders', ordersRouter);

// Escrows management routes
app.use('/api/escrows', escrowsRouter);

// Transactions management routes
app.use('/api/transactions', transactionsRouter);

// Driver profiles management routes
app.use('/api/drivers', driversRouter);

// Merchant profiles management routes
app.use('/api/merchants', merchantsRouter);

// Fuel orders management routes
app.use('/api/fuel-orders', fuelOrdersRouter);

// Delivery feedback management routes
app.use('/api/delivery-feedback', deliveryFeedbackRouter);

// Support tickets management routes
const supportTicketMessagesRouter = require('./routes/support-ticket-messages').default;
app.use('/api/support-tickets', supportTicketMessagesRouter);

// Audit logs management routes  
app.use('/api/audit-logs', auditLogsRouter);

// Tracking management routes
app.use('/api/tracking', trackingRouter);

// Fraud alerts management routes
app.use('/api/fraud-alerts', fraudAlertsRouter);

// Messages management routes
app.use('/api/messages', messagesRouter);

// Notifications management routes
import notificationsRouter from './routes/notifications';
app.use('/api/notifications', notificationsRouter);

// Identity verifications management routes
import identityVerificationsRouter from './routes/identity-verifications';
app.use('/api/identity-verifications', identityVerificationsRouter);

// Error logs management routes
import errorLogsRouter from './routes/error-logs';
app.use('/api/error-logs', errorLogsRouter);

// MFA tokens management routes
import mfaTokensRouter from './routes/mfa-tokens';
app.use('/api/mfa-tokens', mfaTokensRouter);

// JWT tokens management routes
import jwtTokensRouter from './routes/jwt-tokens';
app.use('/api/jwt-tokens', jwtTokensRouter);

// Password reset routes
import passwordResetRouter from './routes/password-reset';
app.use('/api/password-reset', passwordResetRouter);

// Verification documents management routes
import verificationDocumentsRouter from './routes/verification-documents';
app.use('/api/verification-documents', verificationDocumentsRouter);

// Security logs management routes
import securityLogsRouter from './routes/security-logs';
app.use('/api/security-logs', securityLogsRouter);

// Trusted devices management routes
import trustedDevicesRouter from './routes/trusted-devices';
app.use('/api/trusted-devices', trustedDevicesRouter);

// Toll gates management routes
import tollGatesRouter from './routes/toll-gates';
app.use('/api/toll-gates', tollGatesRouter);

// Suspicious activities management routes
import suspiciousActivitiesRouter from './routes/suspicious-activities';
app.use('/api/suspicious-activities', suspiciousActivitiesRouter);

// Admin users management routes
import adminUsersRouter from './routes/admin-users';
app.use('/api/admin-users', adminUsersRouter);

// Content reports management routes
app.use('/api/content-reports', contentReportsRouter);

// Moderation responses management routes
app.use('/api/moderation-responses', moderationResponsesRouter);

// Firebase routes
app.use('/api/firebase', firebaseRouter);

// Mobile routes for cross-platform support
app.use('/api/mobile', mobileRouter);

// iOS specific routes
app.use('/api/ios', iosRoutes);

// Android specific routes
app.use('/api/android', androidRoutes);

// Web specific routes
app.use('/api/web', webRoutes);

// Wallet management routes
import walletRouter from './routes/wallet';
app.use('/api/wallet', walletRouter);

// Search routes
import searchRouter from './routes/search';
app.use('/api/search', searchRouter);

// File upload routes
import uploadRouter from './routes/upload';
app.use('/api/upload', uploadRouter);

// Basic route
app.get('/', (req, res) => {
  res.json({
    message: 'Brill Backend API is running!',
    status: 'success',
    timestamp: new Date().toISOString()
  });
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(process.uptime()),
      human: formatUptime(process.uptime())
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(process.memoryUsage().external / 1024 / 1024 * 100) / 100,
      unit: 'MB'
    },
    environment: process.env.NODE_ENV || 'development'
  };

  res.json(healthData);
});

// Test database endpoint
app.get('/test-db', async (req, res) => {
  try {
    // Try to fetch all users (limit to 10 for testing)
    const allUsers = await db.select().from(users).limit(10);

    res.json({
      success: true,
      message: 'Database query successful',
      data: {
        totalUsers: allUsers.length,
        users: allUsers
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({
      success: false,
      message: 'Database query failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to format uptime
function formatUptime(uptimeSeconds: number): string {
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  return `${hours}h ${minutes}m ${seconds}s`;
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Test database connection
  await testConnection();
});