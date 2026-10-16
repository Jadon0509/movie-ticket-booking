import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { DB } from '../db';
import { config } from '../config';
import { HttpError } from '../errors';
import { signToken } from '../auth';
import { parse } from './util';

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password is too long (max 72 characters)'),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

// Used so a login for an unknown email takes as long as a real one (no timing hint).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export function authRoutes(db: DB, requireAuth: any) {
  const r = Router();

  r.post('/signup', (req, res) => {
    // Note: only name/email/password are read. A "role" in the body is ignored,
    // so sign-up can never create an admin.
    const { name, email, password } = parse(signupSchema, req.body);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
      throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
    const hash = bcrypt.hashSync(password, config.bcryptRounds);
    let id: number;
    try {
      id = Number(db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'customer')`).run(name, email, hash).lastInsertRowid);
    } catch (e: any) {
      if (/UNIQUE|constraint/i.test(String(e.message))) throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
      throw e;
    }
    res.status(201).json({ token: signToken(id), user: { id, name, email, role: 'customer' } });
  });

  r.post('/login', (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    const ok = bcrypt.compareSync(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS'); // never says which
    res.json({ token: signToken(u.id), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  return r;
}
