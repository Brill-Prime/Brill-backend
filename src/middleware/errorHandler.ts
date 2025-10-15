
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public errors?: any[]
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', error);

  // AppError - custom application errors
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      errors: error.errors
    });
  }

  // Zod validation errors
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  // Database errors
  if (error.code === '23505') { // Unique violation
    return res.status(409).json({
      success: false,
      message: 'Resource already exists',
      code: 'DUPLICATE_ENTRY'
    });
  }

  if (error.code === '23503') { // Foreign key violation
    return res.status(400).json({
      success: false,
      message: 'Referenced resource not found',
      code: 'INVALID_REFERENCE'
    });
  }

  if (error.code === '23502') { // Not null violation
    return res.status(400).json({
      success: false,
      message: 'Required field missing',
      code: 'NULL_VIOLATION'
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired',
      code: 'TOKEN_EXPIRED'
    });
  }

  // Default error
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};
