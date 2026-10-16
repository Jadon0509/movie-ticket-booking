import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import type { DB } from './db';
import { makeAuth } from './auth';
import { HttpError } from './errors';
import { authRoutes } from './routes/auth';
import { customerRoutes } from './routes/customer';
import { adminRoutes } from './routes/admin';

export function createApp(db: DB) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  const { requireAuth, requireAdmin } = makeAuth(db);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(db, requireAuth));
  app.use('/api/admin', adminRoutes(db, requireAdmin));
  app.use('/api', customerRoutes(db, requireAuth));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  // One place that turns errors into JSON: { error, code, ...extra }
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
