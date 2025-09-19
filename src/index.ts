
import express from 'express';

const app = express();
const PORT = process.env.PORT || 5000;

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

// Helper function to format uptime
function formatUptime(uptimeSeconds: number): string {
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);
  
  return `${hours}h ${minutes}m ${seconds}s`;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
