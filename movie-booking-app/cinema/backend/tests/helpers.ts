import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { openDb, type DB } from '../src/db';


export interface Ctx { db: DB; api: ReturnType<typeof request>; showId: number; movieId: number; adminToken: string }

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
export const HOUR = 3600_000;

/** Fresh in-memory DB + app with one movie (120 min), one show tomorrow, and an admin. */
export async function setup(): Promise<Ctx> {
  const db = openDb(':memory:');
  const api = request(createApp(db));
  db.prepare(`INSERT INTO users (name,email,password_hash,role) VALUES ('Admin','admin@t.test',?, 'admin')`).run(bcrypt.hashSync('Admin@1234', 4));
  const movieId = Number(db.prepare(`INSERT INTO movies (title,language,duration_minutes,rating) VALUES ('Test Movie','English',120,'U')`).run().lastInsertRowid);
  const showId = addShow(db, movieId, 24 * HOUR);
  const adminToken = (await api.post('/api/auth/login').send({ email: 'admin@t.test', password: 'Admin@1234' })).body.token;
  return { db, api, showId, movieId, adminToken };
}

export function addShow(db: DB, movieId: number, startsInMs: number, price = 200) {
  const start = iso(startsInMs);
  const end = new Date(new Date(start).getTime() + 120 * 60000).toISOString();
  return Number(db.prepare('INSERT INTO shows (movie_id,starts_at,ends_at,price) VALUES (?,?,?,?)').run(movieId, start, end, price).lastInsertRowid);
}

export async function newUser(ctx: Ctx, name: string) {
  const res = await ctx.api.post('/api/auth/signup').send({ name, email: `${name.toLowerCase()}@t.test`, password: 'password123' });
  return { token: res.body.token as string, id: res.body.user.id as number };
}
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
