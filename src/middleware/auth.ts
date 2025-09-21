import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.userId) {
    req.user = req.session.user;
    return next();
  }
  return res.status(401).json({ success: false, error: 'Authentication required' });
}
