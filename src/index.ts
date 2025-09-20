
import express from 'express';
import { testConnection, db } from './db/config';
import { users } from './db/schema';

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
