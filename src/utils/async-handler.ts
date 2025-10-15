
import { Request, Response, NextFunction } from 'express';

/**
 * Wrapper for async route handlers to ensure errors are passed to error middleware
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create standardized error
 */
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
