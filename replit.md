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
✅ Database schema deployed
✅ WebSocket service running
✅ All routes configured
⚠️ Optional services (Firebase, Email, SMS, Payments) need configuration

## Notes
- The application uses trust proxy mode for Replit environment
- Firebase Admin and Email services are optional - the API works without them
- Database migrations use Drizzle's push command (not manual migrations)
- WebSocket connections require JWT authentication
- The escrow auto-release service runs automatically in background

## Deployment
The application is configured for VM deployment on Replit, which maintains persistent connections and background services like the escrow auto-release scheduler.
