import type { DB } from '../db';
import { HttpError } from '../errors';
import { HOLD_MS, MAX_SEATS_PER_BOOKING, ROWS, SEATS_PER_ROW } from '../config';

export type SeatStatus = 'available' | 'held' | 'booked' | 'mine' | 'damaged';
export interface Seat { row: string; number: number; label: string; status: SeatStatus }

const SEAT_RE = /^([A-H])(10|[1-9])$/;

export function parseSeat(label: unknown): { row: string; number: number } | null {
  if (typeof label !== 'string') return null;
  const m = SEAT_RE.exec(label.trim().toUpperCase());
  return m ? { row: m[1], number: Number(m[2]) } : null;
}

interface LockRow { seat_row: string; seat_number: number; user_id: number; status: 'held' | 'booked'; expires_at: string | null }

/**
 * Build the 8x10 map. A seat is "taken" if it is booked, or held with an
 * expiry in the future. Expired holds are simply ignored here (and deleted
 * lazily the next time someone tries to hold), so no background job is needed.
 */
export function getSeatMap(db: DB, showId: number, viewerId: number | null, now: string) {
  const locks = db
    .prepare(
      `SELECT seat_row, seat_number, user_id, status, expires_at FROM seat_locks
       WHERE show_id = ? AND (status = 'booked' OR expires_at > ?)`,
    )
    .all(showId, now) as LockRow[];
  const byLabel = new Map(locks.map((l) => [`${l.seat_row}${l.seat_number}`, l]));
  const damaged = damagedSet(db);

  const seats: Seat[] = [];
  for (const row of ROWS) {
    for (let n = 1; n <= SEATS_PER_ROW; n++) {
      const label = `${row}${n}`;
      const lock = byLabel.get(label);
      let status: SeatStatus = 'available';
      if (damaged.has(label)) status = 'damaged'; // broken seat: nobody can take it
      else if (lock) {
        if (lock.status === 'booked') status = 'booked';
        else status = lock.user_id === viewerId ? 'mine' : 'held';
      }
      seats.push({ row, number: n, label, status });
    }
  }

  const mine = locks.filter((l) => l.status === 'held' && l.user_id === viewerId);
  const myHold = mine.length
    ? { seats: mine.map((l) => `${l.seat_row}${l.seat_number}`), expiresAt: mine[0].expires_at as string }
    : null;

  return { seats, availableCount: seats.filter((s) => s.status === 'available').length, myHold };
}

/**
 * Hold seats for a user for 5 minutes.
 *
 * Everything happens inside ONE transaction taken with BEGIN IMMEDIATE (the
 * write lock is acquired first, so two requests cannot interleave). Inside it
 * we try to INSERT one row per seat. If another user already owns a seat, the
 * PRIMARY KEY makes the insert fail, we report which seats clashed and throw,
 * which rolls the whole transaction back: it is all-or-nothing.
 */
export function holdSeats(db: DB, userId: number, showId: number, labels: unknown, now: string) {
  if (!Array.isArray(labels) || labels.length === 0) throw new HttpError(400, 'Select at least one seat');
  const parsed = labels.map((l) => ({ raw: l, seat: parseSeat(l) }));
  if (parsed.some((p) => !p.seat)) throw new HttpError(400, 'Invalid seat selected');
  const seats = parsed.map((p) => p.seat!);
  const unique = new Set(seats.map((s) => `${s.row}${s.number}`));
  if (unique.size !== seats.length) throw new HttpError(400, 'Duplicate seats selected');
  if (seats.length > MAX_SEATS_PER_BOOKING)
    throw new HttpError(400, `You can select at most ${MAX_SEATS_PER_BOOKING} seats`);

  const expiresAt = new Date(new Date(now).getTime() + HOLD_MS).toISOString();

  const run = db.transaction(() => {
    const show = db.prepare('SELECT id, price, starts_at FROM shows WHERE id = ?').get(showId) as
      | { id: number; price: number; starts_at: string }
      | undefined;
    if (!show) throw new HttpError(404, 'Show not found');
    if (show.starts_at <= now) throw new HttpError(400, 'This show has already started');

    // Damaged seats can never be held. Checked inside the transaction, together with the inserts.
    const broken = damagedSet(db);
    const hitDamaged = seats.map((x) => `${x.row}${x.number}`).filter((l) => broken.has(l));
    if (hitDamaged.length)
      throw new HttpError(
        409,
        `Seat${hitDamaged.length > 1 ? 's' : ''} ${hitDamaged.join(', ')} ${hitDamaged.length > 1 ? 'are' : 'is'} damaged and cannot be booked`,
        'SEAT_DAMAGED',
        { seats: hitDamaged },
      );

    // The user is picking a new set: drop their previous hold on this show.
    db.prepare(`DELETE FROM seat_locks WHERE show_id = ? AND user_id = ? AND status = 'held'`).run(showId, userId);
    // Clean out anybody's expired holds so those seats can be re-used.
    db.prepare(`DELETE FROM seat_locks WHERE show_id = ? AND status = 'held' AND expires_at <= ?`).run(showId, now);

    const insert = db.prepare(
      `INSERT OR IGNORE INTO seat_locks (show_id, seat_row, seat_number, user_id, status, expires_at)
       VALUES (?, ?, ?, ?, 'held', ?)`,
    );
    const taken: string[] = [];
    for (const s of seats) {
      const r = insert.run(showId, s.row, s.number, userId, expiresAt);
      if (r.changes === 0) taken.push(`${s.row}${s.number}`); // primary key said no
    }
    if (taken.length) {
      throw new HttpError(
        409,
        `Seat${taken.length > 1 ? 's' : ''} ${taken.join(', ')} ${taken.length > 1 ? 'are' : 'is'} no longer available`,
        'SEAT_TAKEN',
        { seats: taken },
      );
    }
    return {
      seats: seats.map((s) => `${s.row}${s.number}`),
      expiresAt,
      total: show.price * seats.length,
    };
  });
  return run.immediate();
}

/** Let go of the user's current (unpaid) hold on a show. */
export function releaseHold(db: DB, userId: number, showId: number) {
  db.prepare(`DELETE FROM seat_locks WHERE show_id = ? AND user_id = ? AND status = 'held'`).run(showId, userId);
}

// ---------- damaged seats ----------

function damagedSet(db: DB): Set<string> {
  const rows = db.prepare('SELECT seat_row, seat_number FROM damaged_seats').all() as { seat_row: string; seat_number: number }[];
  return new Set(rows.map((r) => `${r.seat_row}${r.seat_number}`));
}

export function listDamagedSeats(db: DB) {
  return (
    db.prepare('SELECT seat_row, seat_number, reason, marked_at FROM damaged_seats ORDER BY seat_row, seat_number').all() as
      { seat_row: string; seat_number: number; reason: string; marked_at: string }[]
  ).map((r) => ({ seat: `${r.seat_row}${r.seat_number}`, reason: r.reason, markedAt: r.marked_at }));
}

/**
 * Mark a seat as damaged. Refused while that seat is booked or held for any upcoming
 * show, so we never strand a customer who already paid: cancel those bookings first.
 */
export function markSeatDamaged(db: DB, label: unknown, reason: string, now: string) {
  const seat = parseSeat(label);
  if (!seat) throw new HttpError(400, 'Invalid seat (use A1 to H10)');
  const name = `${seat.row}${seat.number}`;
  db.transaction(() => {
    const inUse = db
      .prepare(`SELECT s.id FROM seat_locks l JOIN shows s ON s.id = l.show_id
                WHERE l.seat_row = ? AND l.seat_number = ? AND s.starts_at > ?
                  AND (l.status = 'booked' OR l.expires_at > ?) LIMIT 1`)
      .get(seat.row, seat.number, now, now);
    if (inUse)
      throw new HttpError(409, `Seat ${name} is booked or held for an upcoming show. Cancel those bookings first.`, 'SEAT_IN_USE');
    db.prepare('INSERT OR IGNORE INTO damaged_seats (seat_row, seat_number, reason, marked_at) VALUES (?,?,?,?)')
      .run(seat.row, seat.number, reason, now);
  }).immediate();
  return name;
}

export function repairSeat(db: DB, label: unknown) {
  const seat = parseSeat(label);
  if (!seat) throw new HttpError(400, 'Invalid seat (use A1 to H10)');
  const r = db.prepare('DELETE FROM damaged_seats WHERE seat_row = ? AND seat_number = ?').run(seat.row, seat.number);
  if (Number(r.changes) === 0) throw new HttpError(404, 'That seat is not marked as damaged');
}
