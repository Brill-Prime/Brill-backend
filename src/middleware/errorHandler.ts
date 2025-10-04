
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', error);

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

  // Default error
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};
