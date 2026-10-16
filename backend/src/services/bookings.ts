import type { DB } from '../db';
import { HttpError } from '../errors';
import { CANCEL_CUTOFF_MS } from '../config';

interface HeldRow { seat_row: string; seat_number: number; expires_at: string }

/**
 * Fake payment gateway. `outcome` is chosen by the "Payment success" /
 * "Payment failure" buttons in the UI. In a real app this would be a
 * server-verified callback from the payment provider, never client input.
 */
export function checkout(db: DB, userId: number, showId: number, outcome: 'success' | 'failure', now: string) {
  const run = db.transaction(() => {
    const show = db.prepare('SELECT id, price, starts_at FROM shows WHERE id = ?').get(showId) as
      | { id: number; price: number; starts_at: string }
      | undefined;
    if (!show) throw new HttpError(404, 'Show not found');

    const held = db
      .prepare(`SELECT seat_row, seat_number, expires_at FROM seat_locks
                WHERE show_id = ? AND user_id = ? AND status = 'held' AND expires_at > ?
                ORDER BY seat_row, seat_number`)
      .all(showId, userId, now) as HeldRow[];

    if (held.length === 0) {
      db.prepare(`DELETE FROM seat_locks WHERE show_id = ? AND user_id = ? AND status = 'held'`).run(showId, userId);
      // This delete is committed because we return normally below, then throw outside.
      return { expired: true as const };
    }
    if (outcome === 'failure') {
      // Nothing changes: hold stays so the user can retry until it expires.
      return { failed: true as const, expiresAt: held[0].expires_at };
    }

    const total = show.price * held.length;
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO bookings (user_id, show_id, total_amount, status, created_at) VALUES (?, ?, ?, 'confirmed', ?)`)
      .run(userId, showId, total, now);
    const bookingId = Number(lastInsertRowid);
    const addSeat = db.prepare('INSERT INTO booking_seats (booking_id, seat_row, seat_number) VALUES (?, ?, ?)');
    for (const h of held) addSeat.run(bookingId, h.seat_row, h.seat_number);
    // Convert holds -> booked. Same rows, so no other user can ever slip in between.
    db.prepare(
      `UPDATE seat_locks SET status = 'booked', booking_id = ?, expires_at = NULL
       WHERE show_id = ? AND user_id = ? AND status = 'held' AND expires_at > ?`,
    ).run(bookingId, showId, userId, now);
    return { bookingId };
  });

  const result = run.immediate();
  if ('expired' in result) {
    throw new HttpError(410, 'Your seat hold has expired. Please select your seats again.', 'HOLD_EXPIRED');
  }
  if ('failed' in result) {
    throw new HttpError(402, 'Payment failed. Your seats are still held, you can try again.', 'PAYMENT_FAILED', {
      expiresAt: result.expiresAt,
    });
  }
  return getBookingForUser(db, userId, result.bookingId)!;
}

interface BookingRow {
  id: number; status: string; total_amount: number; created_at: string; cancelled_at: string | null;
  show_id: number; starts_at: string; ends_at: string; title: string; poster_url: string; language: string;
}

const BOOKING_SQL = `
  SELECT b.id, b.status, b.total_amount, b.created_at, b.cancelled_at,
         s.id AS show_id, s.starts_at, s.ends_at, m.title, m.poster_url, m.language
  FROM bookings b
  JOIN shows s ON s.id = b.show_id
  JOIN movies m ON m.id = s.movie_id`;

function shape(db: DB, r: BookingRow) {
  const seats = (
    db.prepare('SELECT seat_row, seat_number FROM booking_seats WHERE booking_id = ? ORDER BY seat_row, seat_number').all(r.id) as {
      seat_row: string; seat_number: number;
    }[]
  ).map((s) => `${s.seat_row}${s.seat_number}`);
  return {
    id: r.id, status: r.status, totalAmount: r.total_amount, createdAt: r.created_at, cancelledAt: r.cancelled_at,
    showId: r.show_id, startsAt: r.starts_at, endsAt: r.ends_at,
    movie: { title: r.title, posterUrl: r.poster_url, language: r.language },
    seats,
  };
}

/** Always filtered by user_id: another user's booking looks exactly like "not found". */
export function getBookingForUser(db: DB, userId: number, bookingId: number) {
  const r = db.prepare(`${BOOKING_SQL} WHERE b.id = ? AND b.user_id = ?`).get(bookingId, userId) as BookingRow | undefined;
  return r ? shape(db, r) : null;
}

/** Upcoming first (soonest first), then past (most recent first). */
export function listBookingsForUser(db: DB, userId: number, now: string) {
  const rows = (db.prepare(`${BOOKING_SQL} WHERE b.user_id = ?`).all(userId) as BookingRow[]).map((r) => shape(db, r));
  const upcoming = rows.filter((b) => b.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = rows.filter((b) => b.startsAt <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return [...upcoming, ...past];
}

export function cancelBooking(db: DB, userId: number, bookingId: number, now: string) {
  const run = db.transaction(() => {
    const b = db
      .prepare(`SELECT b.id, b.status, s.starts_at FROM bookings b JOIN shows s ON s.id = b.show_id
                WHERE b.id = ? AND b.user_id = ?`)
      .get(bookingId, userId) as { id: number; status: string; starts_at: string } | undefined;
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking is already cancelled');
    if (b.starts_at <= now) throw new HttpError(422, 'This show has already started, so it cannot be cancelled', 'CANCEL_TOO_LATE');
    if (new Date(b.starts_at).getTime() - new Date(now).getTime() < CANCEL_CUTOFF_MS)
      throw new HttpError(422, 'Bookings can only be cancelled up to 2 hours before the show starts', 'CANCEL_TOO_LATE');

    db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(now, bookingId);
    // Free the seats immediately: deleting the lock rows makes them available again.
    db.prepare('DELETE FROM seat_locks WHERE booking_id = ?').run(bookingId);
  });
  run.immediate();
  return getBookingForUser(db, userId, bookingId)!;
}
