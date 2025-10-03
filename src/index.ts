
import 'dotenv/config';
import './config/firebase-admin';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { createServer } from 'http';
import { initializeWebSocket } from './services/websocket';
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
import webRoutes from './routes/web';
import realtimeRouter from './routes/realtime';
import cartRoutes from './routes/cart';
import checkoutRoutes from './routes/checkout';
import driverLocationRoutes from './routes/driver-location';
import qrProcessingRoutes from './routes/qr-processing';
import autoAssignmentRoutes from './routes/auto-assignment';
import adminReportsRoutes from './routes/admin-reports';
import adminSystemMetricsRoutes from './routes/admin-system-metrics';
import { responseTimeMiddleware } from './services/realtime-analytics';
import bankAccountsRouter from './routes/bank-accounts';
import supportTicketMessagesRouter from './routes/support-ticket-messages';
import notificationsRouter from './routes/notifications';
import identityVerificationsRouter from './routes/identity-verifications';
import errorLogsRouter from './routes/error-logs';
import mfaTokensRouter from './routes/mfa-tokens';
import jwtTokensRouter from './routes/jwt-tokens';
import passwordResetRouter from './routes/password-reset';
import verificationDocumentsRouter from './routes/verification-documents';
import securityLogsRouter from './routes/security-logs';
import trustedDevicesRouter from './routes/trusted-devices';
import tollGatesRouter from './routes/toll-gates';
import suspiciousActivitiesRouter from './routes/suspicious-activities';
import adminUsersRouter from './routes/admin-users';
import realtimeExamplesRouter from './routes/realtime-examples';
import pushNotificationsRouter from './routes/push-notifications';
import analyticsRouter from './routes/analytics';
import adminDashboardRouter from './routes/admin-dashboard';
import configRouter from './routes/config';
import healthRouter from './routes/health';
import driverVerificationRouter from './routes/driver-verification';
import deliveryAssignmentsRoutes from './routes/delivery-assignments';
import searchRouter from './routes/search';
import uploadRouter from './routes/upload';
import geolocationRouter from './routes/geolocation';
import webhookRouter from './routes/webhooks';
import paymentsRouter from './routes/payments';
import paystackWebhooksRouter from './routes/paystack-webhooks';
import escrowStatusRoutes from './routes/escrow-status';
import { startEscrowAutoReleaseService } from './services/escrow-auto-release';
import driverOrdersRoutes from './routes/driver-orders';

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '5000', 10);

// Trust proxy - required for Replit environment and rate limiting
app.set('trust proxy', 1);

// Initialize WebSocket service
const wsService = initializeWebSocket(server);

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

// Add response time tracking middleware
app.use(responseTimeMiddleware);

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
app.use('/api/support-tickets', supportTicketsRouter);

// Support ticket messages management routes
app.use('/api/support-ticket-messages', supportTicketMessagesRouter);

// Audit logs management routes
app.use('/api/audit-logs', auditLogsRouter);

// Tracking management routes
app.use('/api/tracking', trackingRouter);

// Fraud alerts management routes
app.use('/api/fraud-alerts', fraudAlertsRouter);

// Messages management routes
app.use('/api/messages', messagesRouter);

// Notifications management routes
app.use('/api/notifications', notificationsRouter);

// Identity verifications management routes
app.use('/api/identity-verifications', identityVerificationsRouter);

// Error logs management routes
app.use('/api/error-logs', errorLogsRouter);

// MFA tokens management routes
app.use('/api/mfa-tokens', mfaTokensRouter);

// JWT tokens management routes
app.use('/api/jwt-tokens', jwtTokensRouter);

// Password reset routes
app.use('/api/password-reset', passwordResetRouter);

// Verification documents management routes
app.use('/api/verification-documents', verificationDocumentsRouter);

// Security logs management routes
app.use('/api/security-logs', securityLogsRouter);

// Trusted devices management routes
app.use('/api/trusted-devices', trustedDevicesRouter);

// Toll gates management routes
app.use('/api/toll-gates', tollGatesRouter);

// Suspicious activities management routes
app.use('/api/suspicious-activities', suspiciousActivitiesRouter);

// Admin users management routes
app.use('/api/admin-users', adminUsersRouter);

// Content reports management routes
app.use('/api/content-reports', contentReportsRouter);

// Moderation responses management routes
app.use('/api/moderation-responses', moderationResponsesRouter);

// Firebase routes
app.use('/api/firebase', firebaseRouter);

// Web specific routes
app.use('/api/web', webRoutes);

// Real-time communication routes
app.use('/api/realtime', realtimeRouter);

// Real-time examples and integration guide
app.use('/api/realtime-examples', realtimeExamplesRouter);

// Push notifications routes
app.use('/api/push-notifications', pushNotificationsRouter);

// Analytics routes
app.use('/api/analytics', analyticsRouter);

// Admin dashboard routes
app.use('/api/admin-dashboard', adminDashboardRouter);

// Configuration routes
app.use('/api/config', configRouter);

// Health check routes
app.use('/api/health', healthRouter);

// Apply rate limiting to auth routes
import RateLimitingService from './services/rateLimiting';
app.use('/auth', RateLimitingService.authLimit);
app.use('/api', RateLimitingService.apiLimit);

// Driver verification routes
app.use('/api/driver-verification', driverVerificationRouter);

// Delivery assignment routes
app.use('/api/delivery-assignments', deliveryAssignmentsRoutes);

// Search routes
app.use('/api/search', searchRouter);

// File upload routes
app.use('/api/upload', uploadRouter);

// Geolocation routes
app.use('/api/geolocation', geolocationRouter);

// Webhook routes
app.use('/api/webhooks', webhookRouter);

// Payment routes
app.use('/api/payments', paymentsRouter);

// Cart routes
app.use('/api/cart', cartRoutes);

// Checkout routes
app.use('/api/checkout', checkoutRoutes);

// Bank accounts management routes
app.use('/api/bank-accounts', bankAccountsRouter);

// Paystack webhook routes
app.use('/api/paystack', paystackWebhooksRouter);

// Register new routes
app.use('/api/driver/location', driverLocationRoutes);
app.use('/api/qr', qrProcessingRoutes);
app.use('/api/orders/auto-assign', autoAssignmentRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/admin/system-metrics', adminSystemMetricsRoutes);

// Register escrow status route
app.use('/api/escrow-status', escrowStatusRoutes);

// Register driver-orders route
app.use('/api/driver', driverOrdersRoutes);

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

// Start escrow auto-release service
startEscrowAutoReleaseService();

// Start server
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 WebSocket server running on ws://0.0.0.0:${PORT}/ws`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('Firebase Realtime Database is configured.');
});

// Helper function to format uptime
function formatUptime(uptimeSeconds: number): string {
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  return `${hours}h ${minutes}m ${seconds}s`;
}
