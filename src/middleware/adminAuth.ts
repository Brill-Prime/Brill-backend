import { Request, Response, NextFunction } from 'express';

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.user && req.session.user.role === 'ADMIN') {
    req.user = req.session.user;
    return next();
  }
  return res.status(403).json({ success: false, error: 'Admin privileges required' });
}
