import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { DB } from './db';
import { config } from './config';
import { HttpError } from './errors';

export interface AuthUser { id: number; name: string; email: string; role: 'customer' | 'admin' }
declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export const signToken = (userId: number) => jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: '7d' });

export function makeAuth(db: DB) {
  /** Verifies the JWT and loads the user fresh from the DB (so role changes / deleted users apply at once). */
  const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Please log in to continue', 'UNAUTHENTICATED');
    let userId: number;
    try {
      userId = Number((jwt.verify(token, config.jwtSecret) as { sub: string }).sub);
    } catch {
      throw new HttpError(401, 'Your session has expired. Please log in again', 'UNAUTHENTICATED');
    }
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId) as AuthUser | undefined;
    if (!user) throw new HttpError(401, 'Please log in to continue', 'UNAUTHENTICATED');
    req.user = user;
    next();
  };
  const requireAdmin = (req: Request, res: Response, next: NextFunction) =>
    requireAuth(req, res, () => {
      if (req.user!.role !== 'admin') return next(new HttpError(403, 'Admin access required', 'FORBIDDEN'));
      next();
    });
  return { requireAuth, requireAdmin };
}
