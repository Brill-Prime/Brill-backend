# Brillprime Backend

## Overview
This is the backend API for the Brillprime application - a comprehensive delivery and marketplace platform. It's built with Node.js, Express, TypeScript, and PostgreSQL (using Drizzle ORM).

## Tech Stack
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon-backed on Replit)
- **ORM**: Drizzle ORM
- **Real-time**: WebSocket (ws)
- **Authentication**: JWT + Express Session
- **Optional Services**: Firebase Admin, Twilio SMS, Paystack Payments, Nodemailer

## Project Structure
```
src/
├── config/          # Configuration files (Firebase, etc.)
├── db/              # Database schema and connection
├── routes/          # API route handlers
├── services/        # Business logic services
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── index.ts         # Main application entry point
```

## Key Features
- User management (Consumers, Merchants, Drivers, Admins)
- Order processing and tracking
- Real-time delivery tracking via WebSocket
- Escrow payment system
- Product catalog and categories
- Support ticket system
- Audit logging and security
- Driver verification and management
- Fuel order processing
- Analytics and reporting

## Environment Configuration

### Required Environment Variables
These are automatically provided by Replit:
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (default: 5000)

### Optional Environment Variables
Configure these in Replit Secrets for additional features:

**Authentication**
- `JWT_SECRET` - JWT signing secret
- `SESSION_SECRET` - Express session secret

**Firebase (Optional - for Firebase features)**
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON
- `FIREBASE_DATABASE_URL` - Firebase Realtime Database URL
- `FIREBASE_STORAGE_BUCKET` - Firebase Storage bucket

**Email Service (Optional)**
- `GMAIL_USER` / `GMAIL_PASS` - For Gmail SMTP
- OR `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - For custom SMTP

**SMS Service (Optional)**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

**Payment Gateway (Optional)**
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`

**Maps (Optional)**
- `GOOGLE_MAPS_API_KEY`

## Development

### Database Management
```bash
# Push schema changes to database
npm run db:push

# Force push (if data loss warning appears)
npm run db:push --force

# Generate migrations (not recommended - use db:push instead)
npm run db:generate

# Open Drizzle Studio (database GUI)
npm run db:studio
```

### Running the Application
The server automatically starts in development mode via the configured workflow.

## API Endpoints

### Health & Status
- `GET /` - Basic API status
- `GET /health` - Enhanced health check
- `GET /api/health` - Detailed health check

### Authentication
- `POST /auth/*` - Various auth endpoints

### Main Resources
- `/api/users` - User management
- `/api/categories` - Product categories
- `/api/products` - Product catalog
- `/api/orders` - Order management
- `/api/escrows` - Escrow transactions
- `/api/transactions` - Payment transactions
- `/api/drivers` - Driver management
- `/api/merchants` - Merchant profiles
- `/api/support-tickets` - Support system
- `/api/tracking` - Delivery tracking
- `/api/analytics` - Analytics data
- `/api/admin-dashboard` - Admin panel

### Real-time
- WebSocket endpoint: `ws://your-domain/ws`
- Requires JWT authentication token as query parameter

## Current Status
✅ Backend API is fully functional
✅ Successfully migrated to Replit environment (October 18, 2025)
✅ Database schema deployed (Replit PostgreSQL)
✅ Node.js upgraded to version 20.x
✅ SSL/TLS database connection configured
✅ WebSocket service running
✅ All routes configured
✅ Password strength validation implemented
✅ Enhanced health check endpoints
✅ Security audit completed
⚠️ Optional services (Firebase, Gmail, SMS, Payments) need configuration

## Recent Improvements (October 2025)

### Migration to Replit (October 18, 2025)
- **Environment Setup**: Successfully migrated from external hosting to Replit
- **Node.js Upgrade**: Upgraded from Node.js 18.x to 20.x for better compatibility
- **Database Configuration**: Fixed SSL/TLS configuration for Replit PostgreSQL
  - Removed `sslmode=disable` parameter from connection strings
  - Configured proper SSL settings for hosted database
  - Updated both application and Drizzle Kit configurations
- **TypeScript Configuration**: Fixed deprecated compiler options
- **Package Installation**: All npm dependencies successfully installed

### Security Enhancements
- **Password Validation**: Implemented comprehensive password strength validation
  - Minimum 8 characters with uppercase, lowercase, numbers, and special characters
  - Common password pattern detection
  - Compromised password checking
  - Applied to user creation and password reset endpoints

### Code Quality
- Removed stale TODO comments from production code
- Fixed database schema index errors
- Enhanced error handling consistency
- Improved logging for service status

### Monitoring & Health
- **Enhanced Health Checks**: `/api/health/detailed` endpoint now includes:
  - PostgreSQL database connection status
  - Firebase service status
  - Email service provider detection (Gmail OAuth, SMTP, etc.)
  - SMS and Payment gateway configuration
  - JWT secret validation
  - System metrics (memory, CPU, uptime)

### Documentation
- Created comprehensive security and bug report
- Updated project documentation with latest changes
- Password validator utility with strength assessment

## Notes
- The application uses trust proxy mode for Replit environment
- Firebase Admin and Email services are optional - the API works without them
- Database migrations use Drizzle's push command (not manual migrations)
- WebSocket connections require JWT authentication
- The escrow auto-release service runs automatically in background
- Gmail OAuth is configured via Replit integration for email notifications
- Password strength validation enforces security best practices

## Deployment
The application is configured for VM deployment on Replit, which maintains persistent connections and background services like the escrow auto-release scheduler.
