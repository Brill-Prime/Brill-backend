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
app.use('/api/support-tickets', supportTicketsRouter);

// Support ticket messages management routes
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