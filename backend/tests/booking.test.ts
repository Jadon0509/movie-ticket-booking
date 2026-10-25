import { beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../src/db';
import { holdSeats } from '../src/services/seats';
import { HttpError } from '../src/errors';
import { addShow, bearer, HOUR, newUser, setup, type Ctx } from './helpers';

let ctx: Ctx;
beforeEach(async () => { ctx = await setup(); });

const hold = (ctx: Ctx, token: string, seats: string[], showId = ctx.showId) =>
  ctx.api.post(`/api/shows/${showId}/hold`).set(bearer(token)).send({ seats });
const pay = (ctx: Ctx, token: string, outcome: 'success' | 'failure', showId = ctx.showId) =>
  ctx.api.post(`/api/shows/${showId}/checkout`).set(bearer(token)).send({ outcome });

describe('double booking (the most important rule)', () => {
  it('two users racing for the same seat: exactly one wins', async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    const [ra, rb] = await Promise.all([hold(ctx, a.token, ['C4', 'C5']), hold(ctx, b.token, ['C5', 'C6'])]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.seats).toEqual(['C5']);
    // all-or-nothing: the loser must not be left holding C4 or C6
    const rows = ctx.db.prepare('SELECT seat_row||seat_number AS s FROM seat_locks').all().map((r: any) => r.s).sort();
    expect(rows).toHaveLength(2);
  });

  it('the database itself rejects a second row for the same seat (no app code involved)', () => {
    const u = ctx.db.prepare(`INSERT INTO users (name,email,password_hash) VALUES ('x','x@t.test','h')`).run().lastInsertRowid;
    const ins = () => ctx.db.prepare(`INSERT INTO seat_locks (show_id,seat_row,seat_number,user_id,status,expires_at) VALUES (?, 'A', 1, ?, 'held', '2999-01-01T00:00:00.000Z')`).run(ctx.showId, u);
    ins();
    expect(ins).toThrow(/UNIQUE|PRIMARY KEY/i);
  });

  it('holds on two SEPARATE database connections still cannot overlap', async () => {
    const file = join(tmpdir(), `cinema-race-${Date.now()}.db`);
    const db1 = openDb(file);
    const db2 = openDb(file); // a second connection, like a second server process
    try {
      db1.prepare(`INSERT INTO users (name,email,password_hash) VALUES ('a','a@t.test','h'),('b','b@t.test','h')`).run();
      db1.prepare(`INSERT INTO movies (title,language,duration_minutes,rating) VALUES ('M','English',100,'U')`).run();
      const show = addShow(db1, 1, 24 * HOUR);
      const now = new Date().toISOString();
      const results = [holdSeats(db1, 1, show, ['D4'], now), (() => { try { return holdSeats(db2, 2, show, ['D4'], now); } catch (e) { return e; } })()];
      expect(results[0]).toHaveProperty('expiresAt');
      expect(results[1]).toBeInstanceOf(HttpError);
      expect((results[1] as HttpError).status).toBe(409);
    } finally {
      db1.close(); db2.close();
      for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
    }
  });
});

describe('hold + payment (flows 4 and 5)', () => {
  it('limits a selection to 6 seats', async () => {
    const a = await newUser(ctx, 'Alice');
    const res = await hold(ctx, a.token, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 6/);
  });

  it('payment success creates a booking and the seats become booked', async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    await hold(ctx, a.token, ['B2', 'B3']);
    const res = await pay(ctx, a.token, 'success');
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ seats: ['B2', 'B3'], totalAmount: 400, status: 'confirmed' });
    expect((await hold(ctx, b.token, ['B2'])).status).toBe(409);
    const map = await ctx.api.get(`/api/shows/${ctx.showId}/seats`).set(bearer(b.token));
    expect(map.body.seats.find((s: any) => s.label === 'B2').status).toBe('booked');
    expect(map.body.availableCount).toBe(78);
  });

  it('payment failure creates no booking and keeps the hold for a retry', async () => {
    const a = await newUser(ctx, 'Alice');
    await hold(ctx, a.token, ['E1']);
    const fail = await pay(ctx, a.token, 'failure');
    expect(fail.status).toBe(402);
    expect(fail.body.code).toBe('PAYMENT_FAILED');
    expect(ctx.db.prepare('SELECT COUNT(*) c FROM bookings').get()).toEqual({ c: 0 });
    expect((await pay(ctx, a.token, 'success')).status).toBe(201); // retry works
  });

  it('paying after the hold expired is rejected and the seat is free again for others', async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    await hold(ctx, a.token, ['F5']);
    ctx.db.prepare(`UPDATE seat_locks SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString()); // time passes
    const late = await pay(ctx, a.token, 'success');
    expect(late.status).toBe(410);
    expect(late.body.code).toBe('HOLD_EXPIRED');
    expect((await hold(ctx, b.token, ['F5'])).status).toBe(201);
  });

  it('an expired hold of someone else does not block a new hold', async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    await hold(ctx, a.token, ['G1']);
    ctx.db.prepare(`UPDATE seat_locks SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    expect((await hold(ctx, b.token, ['G1'])).status).toBe(201);
  });

  it('seat map shows held-by-other as "held" and own hold as "mine"', async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    await hold(ctx, a.token, ['H10']);
    const seatOf = async (t: string) => (await ctx.api.get(`/api/shows/${ctx.showId}/seats`).set(bearer(t))).body.seats.find((s: any) => s.label === 'H10').status;
    expect(await seatOf(a.token)).toBe('mine');
    expect(await seatOf(b.token)).toBe('held');
  });
});

describe('auth (flow 1)', () => {
  it('rejects short passwords and duplicate emails', async () => {
    expect((await ctx.api.post('/api/auth/signup').send({ name: 'A', email: 'a@t.test', password: 'short' })).status).toBe(400);
    await newUser(ctx, 'Alice');
    const dup = await ctx.api.post('/api/auth/signup').send({ name: 'A2', email: 'ALICE@t.test', password: 'password123' });
    expect(dup.status).toBe(409);
  });

  it('stores only a hash and gives the same error for wrong email and wrong password', async () => {
    await newUser(ctx, 'Alice');
    const row = ctx.db.prepare(`SELECT password_hash FROM users WHERE email='alice@t.test'`).get() as any;
    expect(row.password_hash).not.toContain('password123');
    const wrongPw = await ctx.api.post('/api/auth/login').send({ email: 'alice@t.test', password: 'nope-nope' });
    const wrongEmail = await ctx.api.post('/api/auth/login').send({ email: 'ghost@t.test', password: 'password123' });
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body.error).toBe(wrongEmail.body.error);
  });

  it('protected APIs reject requests without a login', async () => {
    for (const [m, url] of [['get', `/api/shows/${ctx.showId}/seats`], ['post', `/api/shows/${ctx.showId}/hold`], ['get', '/api/bookings']] as const)
      expect((await (ctx.api as any)[m](url)).status).toBe(401);
  });

  it('sign-up can never create an admin', async () => {
    const res = await ctx.api.post('/api/auth/signup').send({ name: 'Sneaky', email: 's@t.test', password: 'password123', role: 'admin' });
    expect(res.body.user.role).toBe('customer');
  });
});

describe('my bookings (flow 6) and cancelling (flow 8)', () => {
  it("a user cannot see or cancel someone else's booking", async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    await hold(ctx, a.token, ['A1']);
    const id = (await pay(ctx, a.token, 'success')).body.booking.id;
    expect((await ctx.api.get(`/api/bookings/${id}`).set(bearer(b.token))).status).toBe(404);
    expect((await ctx.api.post(`/api/bookings/${id}/cancel`).set(bearer(b.token))).status).toBe(404);
    expect((await ctx.api.get('/api/bookings').set(bearer(b.token))).body.bookings).toHaveLength(0);
    expect((await ctx.api.get(`/api/bookings/${id}`).set(bearer(a.token))).status).toBe(200);
  });

  it('lists upcoming bookings first, then past ones', async () => {
    const a = await newUser(ctx, 'Alice');
    const past = addShow(ctx.db, ctx.movieId, -48 * HOUR);
    const later = addShow(ctx.db, ctx.movieId, 72 * HOUR);
    for (const s of [ctx.showId, later]) { await hold(ctx, a.token, ['A1'], s); await pay(ctx, a.token, 'success', s); }
    ctx.db.prepare(`INSERT INTO bookings (user_id,show_id,total_amount,status,created_at) VALUES (?,?,200,'confirmed','2020-01-01T00:00:00.000Z')`).run(a.id, past);
    const list = (await ctx.api.get('/api/bookings').set(bearer(a.token))).body.bookings.map((b: any) => b.showId);
    expect(list).toEqual([ctx.showId, later, past]);
  });

  it('cancels more than 2h before the show and frees the seats immediately', async () => {
    const a = await newUser(ctx, 'Alice');
    const b = await newUser(ctx, 'Bob');
    await hold(ctx, a.token, ['A1', 'A2']);
    const id = (await pay(ctx, a.token, 'success')).body.booking.id;
    const res = await ctx.api.post(`/api/bookings/${id}/cancel`).set(bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
    expect((await hold(ctx, b.token, ['A1'])).status).toBe(201);
  });

  it('refuses to cancel inside the 2h window', async () => {
    const a = await newUser(ctx, 'Alice');
    const soon = addShow(ctx.db, ctx.movieId, 1 * HOUR);
    await hold(ctx, a.token, ['A1'], soon);
    const id = (await pay(ctx, a.token, 'success', soon)).body.booking.id;
    const res = await ctx.api.post(`/api/bookings/${id}/cancel`).set(bearer(a.token));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/2 hours/);
  });
});

describe('browsing (flow 2)', () => {
  it('does not list shows that already started and reports available seats', async () => {
    const a = await newUser(ctx, 'Alice');
    addShow(ctx.db, ctx.movieId, -1 * HOUR);
    await hold(ctx, a.token, ['A1', 'A2']);
    const { shows } = (await ctx.api.get(`/api/movies/${ctx.movieId}`)).body;
    expect(shows).toHaveLength(1);
    expect(shows[0].availableSeats).toBe(78);
  });
});

describe('admin (flows 7 and 9)', () => {
  const admin = (c: Ctx) => bearer(c.adminToken);

  it('customers cannot call admin APIs', async () => {
    const a = await newUser(ctx, 'Alice');
    expect((await ctx.api.get('/api/admin/shows').set(bearer(a.token))).status).toBe(403);
    expect((await ctx.api.post('/api/admin/movies').set(bearer(a.token)).send({})).status).toBe(403);
    expect((await ctx.api.get('/api/admin/shows')).status).toBe(401);
  });

  it('rejects overlapping shows on the single screen but allows back-to-back ones', async () => {
    // existing show: tomorrow, 120 min
    const start = new Date(Date.now() + 24 * HOUR);
    const at = (mins: number) => new Date(start.getTime() + mins * 60000).toISOString();
    const post = (startsAt: string) => ctx.api.post('/api/admin/shows').set(admin(ctx)).send({ movieId: ctx.movieId, startsAt, price: 200 });
    const clash = await post(at(60));
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('SHOW_OVERLAP');
    expect((await post(at(-60))).status).toBe(409); // new show would end inside the existing one
    expect((await post(at(120))).status).toBe(201); // starts exactly when the other ends
  });

  it('cannot delete a show that has bookings, can delete one without', async () => {
    const a = await newUser(ctx, 'Alice');
    await hold(ctx, a.token, ['A1']);
    await pay(ctx, a.token, 'success');
    expect((await ctx.api.delete(`/api/admin/shows/${ctx.showId}`).set(admin(ctx))).status).toBe(409);
    const empty = addShow(ctx.db, ctx.movieId, 100 * HOUR);
    expect((await ctx.api.delete(`/api/admin/shows/${empty}`).set(admin(ctx))).status).toBe(204);
  });

  it('movie CRUD works and validates input', async () => {
    const body = { title: 'New', language: 'Hindi', durationMinutes: 90, rating: 'UA' };
    const created = await ctx.api.post('/api/admin/movies').set(admin(ctx)).send(body);
    expect(created.status).toBe(201);
    const id = created.body.movie.id;
    expect((await ctx.api.put(`/api/admin/movies/${id}`).set(admin(ctx)).send({ ...body, title: 'Renamed' })).body.movie.title).toBe('Renamed');
    expect((await ctx.api.post('/api/admin/movies').set(admin(ctx)).send({ ...body, rating: 'X' })).status).toBe(400);
    expect((await ctx.api.delete(`/api/admin/movies/${id}`).set(admin(ctx))).status).toBe(204);
  });

  it('shows per-show stats and the booking list', async () => {
    const a = await newUser(ctx, 'Alice');
    await hold(ctx, a.token, ['A1', 'A2']);
    await pay(ctx, a.token, 'success');
    const res = await ctx.api.get(`/api/admin/shows/${ctx.showId}`).set(admin(ctx));
    expect(res.body.show).toMatchObject({ bookedSeats: 2, totalSeats: 80, percentFull: 3, revenue: 400 });
    expect(res.body.bookings[0]).toMatchObject({ customerName: 'Alice', seats: ['A1', 'A2'] });
    expect(res.body.seats.find((s: any) => s.label === 'A1').status).toBe('booked');
  });
});

describe('damaged seats', () => {
  const admin = (c: Ctx) => bearer(c.adminToken);
  const markDamaged = (c: Ctx, seat: string) => c.api.post('/api/admin/damaged-seats').set(admin(c)).send({ seat });

  it('a damaged seat cannot be held, and nothing else in that request is held either', async () => {
    const a = await newUser(ctx, 'Alice');
    expect((await markDamaged(ctx, 'C4')).status).toBe(201);
    const res = await hold(ctx, a.token, ['C3', 'C4']);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_DAMAGED');
    expect(res.body.seats).toEqual(['C4']);
    expect(res.body.error).toMatch(/damaged/);
    expect(ctx.db.prepare('SELECT COUNT(*) c FROM seat_locks').get()).toEqual({ c: 0 }); // all-or-nothing
  });

  it('shows the seat as damaged on the map and removes it from the available counts', async () => {
    const a = await newUser(ctx, 'Alice');
    await markDamaged(ctx, 'H10');
    const map = (await ctx.api.get(`/api/shows/${ctx.showId}/seats`).set(bearer(a.token))).body;
    expect(map.seats.find((s: any) => s.label === 'H10').status).toBe('damaged');
    expect(map.availableCount).toBe(79);
    expect((await ctx.api.get(`/api/movies/${ctx.movieId}`)).body.shows[0].availableSeats).toBe(79);
  });

  it('a repaired seat can be booked again', async () => {
    const a = await newUser(ctx, 'Alice');
    await markDamaged(ctx, 'B2');
    expect((await hold(ctx, a.token, ['B2'])).status).toBe(409);
    expect((await ctx.api.delete('/api/admin/damaged-seats/B2').set(admin(ctx))).status).toBe(204);
    expect((await hold(ctx, a.token, ['B2'])).status).toBe(201);
  });

  it('cannot mark a seat that is booked for an upcoming show', async () => {
    const a = await newUser(ctx, 'Alice');
    await hold(ctx, a.token, ['D5']);
    await pay(ctx, a.token, 'success');
    const res = await markDamaged(ctx, 'D5');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_IN_USE');
  });

  it('only admins can mark or list damaged seats; bad seat names are rejected', async () => {
    const a = await newUser(ctx, 'Alice');
    expect((await ctx.api.post('/api/admin/damaged-seats').set(bearer(a.token)).send({ seat: 'A1' })).status).toBe(403);
    expect((await ctx.api.get('/api/admin/damaged-seats')).status).toBe(401);
    expect((await markDamaged(ctx, 'Z99')).status).toBe(400);
    expect((await ctx.api.delete('/api/admin/damaged-seats/A1').set(admin(ctx))).status).toBe(404);
  });
});
