// Admin Session Management
// View current session
router.get('/session', requireAdminAuth, async (req, res) => {
  // For now, only return current session info
  return res.json({ success: true, session: req.session });
});

// Revoke current session (logout)
router.post('/session/revoke', requireAdminAuth, async (req, res) => {
  await logAdminAction({ userId: req.user.id, action: 'REVOKE_SESSION', entityType: 'USER', entityId: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  req.session.destroy(() => {
    res.json({ success: true, message: 'Session revoked' });
  });
});
// Admin Registration (restricted)
const adminRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  invitationCode: z.string().optional()
});

router.post('/register', requireAdminAuth, async (req, res) => {
  // Only super-admins can register new admins, or require invitation code
  const currentUser = req.user;
  if (!currentUser || currentUser.role !== 'ADMIN' || !currentUser.isSuperAdmin) {
    return res.status(403).json({ success: false, error: 'Super-admin privileges required' });
  }
  const userData = adminRegisterSchema.parse(req.body);
  // Optionally, validate invitationCode here
  const [existingUser] = await db.select().from(users).where(eq(users.email, userData.email)).limit(1);
  if (existingUser) {
    return res.status(400).json({ success: false, error: 'Admin already exists' });
  }
  const passwordHash = await bcrypt.hash(userData.password, 10);
  const newUsers = await db.insert(users).values({
    email: userData.email,
    fullName: userData.fullName,
    phone: userData.phone,
    role: 'ADMIN',
    password: passwordHash,
    createdAt: new Date()
  }).returning();
  const newUser = newUsers[0];
  await logAdminAction({ userId: currentUser.id, action: 'CREATE_ADMIN', entityType: 'USER', entityId: newUser.id, details: { email: newUser.email }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  return res.json({ success: true, user: newUser });
});
import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db/config';
import { users, mfaTokens } from '../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/email';
import { createOTP, validateOTP } from '../services/otp';
import { logAdminAction } from '../services/audit';
import { requireAdminAuth } from '../middleware/adminAuth';

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

// Admin Login Step 1: Password check, send OTP
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await logAdminAction({ userId: user.id, action: 'FAILED_LOGIN', entityType: 'USER', entityId: user.id, details: { email }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    }
    // Generate OTP for MFA
    const otp = await createOTP(user.id, 'login');
    await sendOTPEmail(user.email, otp, user.fullName);
    await logAdminAction({ userId: user.id, action: 'SEND_LOGIN_OTP', entityType: 'USER', entityId: user.id, details: { email }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    // Store userId in session for next step
    req.session.mfaUserId = user.id;
    return res.json({ success: true, message: 'OTP sent to admin email. Please verify.' });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Admin Login Step 2: OTP verification
router.post('/login/verify', async (req, res) => {
  try {
    const { otp } = req.body;
    const userId = req.session.mfaUserId;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'No login session found. Please login again.' });
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
    }
    const valid = await validateOTP(user.id, otp, 'login');
    if (!valid) {
      await logAdminAction({ userId: user.id, action: 'FAILED_LOGIN_OTP', entityType: 'USER', entityId: user.id, details: { otp }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
      return res.status(401).json({ success: false, error: 'Invalid or expired OTP' });
    }
    req.session.user = user;
    delete req.session.mfaUserId;
    await logAdminAction({ userId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id, details: { email: user.email }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Admin Logout
router.post('/logout', requireAdminAuth, async (req, res) => {
  await logAdminAction({ userId: req.user.id, action: 'LOGOUT', entityType: 'USER', entityId: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Request Password Reset (OTP)
router.post('/password-reset/request', async (req, res) => {
  const { email } = req.body;
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.role !== 'ADMIN') {
    return res.status(404).json({ success: false, error: 'Admin not found' });
  }
  const otp = await createOTP(user.id, 'email');
  await sendOTPEmail(email, otp, user.fullName);
  await logAdminAction({ userId: user.id, action: 'REQUEST_PASSWORD_RESET', entityType: 'USER', entityId: user.id, details: { email }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  return res.json({ success: true, message: 'OTP sent to email' });
});

// Confirm Password Reset
router.post('/password-reset/confirm', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.role !== 'ADMIN') {
    return res.status(404).json({ success: false, error: 'Admin not found' });
  }
  const valid = await validateOTP(user.id, otp, 'email');
  if (!valid) {
    return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
  }
  const hashed = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ password: hashed }).where(eq(users.id, user.id));
  await logAdminAction({ userId: user.id, action: 'CONFIRM_PASSWORD_RESET', entityType: 'USER', entityId: user.id, details: { email }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  return res.json({ success: true, message: 'Password updated' });
});

// View Admin Profile
router.get('/profile', requireAdminAuth, async (req, res) => {
  await logAdminAction({ userId: req.user.id, action: 'VIEW_PROFILE', entityType: 'USER', entityId: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  return res.json({ success: true, user: req.user });
});

// Update Admin Profile
router.put('/profile', requireAdminAuth, async (req, res) => {
  const { fullName, phone } = req.body;
  await db.update(users).set({ fullName, phone }).where(eq(users.id, req.user.id));
  await logAdminAction({ userId: req.user.id, action: 'UPDATE_PROFILE', entityType: 'USER', entityId: req.user.id, details: { fullName, phone }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  return res.json({ success: true });
});

export default router;
