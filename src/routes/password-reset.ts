
import express from 'express';
import { z } from 'zod';
import { PasswordResetService } from '../services/passwordReset';
import { PasswordValidator } from '../utils/password-validator';

const router = express.Router();

// Validation schemas
const requestResetSchema = z.object({
  email: z.string().email('Invalid email format')
});

const verifyCodeSchema = z.object({
  email: z.string().email('Invalid email format'),
  resetCode: z.string().length(6, 'Reset code must be 6 digits')
});

const completeResetSchema = z.object({
  email: z.string().email('Invalid email format'),
  resetCode: z.string().length(6, 'Reset code must be 6 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

// Step 1: Request password reset code
router.post('/request', async (req, res) => {
  try {
    const { email } = requestResetSchema.parse(req.body);

    const success = await PasswordResetService.requestPasswordReset(email);

    if (success) {
      res.json({
        success: true,
        message: 'If an account with that email exists, we have sent a reset code.'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send reset code. Please try again.'
      });
    }
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
});

// Step 2: Verify reset code
router.post('/verify-code', async (req, res) => {
  try {
    const { email, resetCode } = verifyCodeSchema.parse(req.body);

    const result = await PasswordResetService.verifyResetCode(email, resetCode);

    if (result.valid) {
      res.json({
        success: true,
        message: 'Reset code verified successfully',
        token: result.token
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired reset code'
      });
    }
  } catch (error) {
    console.error('Reset code verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify reset code'
    });
  }
});

// Step 3: Complete password reset
router.post('/complete', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = completeResetSchema.parse(req.body);

    // Validate password strength
    const passwordValidation = PasswordValidator.validate(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Password does not meet security requirements',
        errors: passwordValidation.errors,
        strength: passwordValidation.strength
      });
    }

    // Check if password is compromised
    const isCompromised = await PasswordValidator.checkCompromised(newPassword);
    if (isCompromised) {
      return res.status(400).json({
        success: false,
        message: 'This password has been found in data breaches. Please choose a different password.'
      });
    }

    const success = await PasswordResetService.completePasswordReset(email, resetCode, newPassword);

    if (success) {
      res.json({
        success: true,
        message: 'Password reset successfully. You can now sign in with your new password.'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid reset code or failed to reset password'
      });
    }
  } catch (error) {
    console.error('Password reset completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete password reset'
    });
  }
});

export default router;
