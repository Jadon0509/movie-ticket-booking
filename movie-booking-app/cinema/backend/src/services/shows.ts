import type { DB } from '../db';
import { HttpError } from '../errors';
import { TOTAL_SEATS } from '../config';

export interface MovieInput {
  title: string; description: string; posterUrl: string; language: string; durationMinutes: number; rating: 'U' | 'UA' | 'A';
}

const movieOut = (m: any) => ({
  id: m.id, title: m.title, description: m.description, posterUrl: m.poster_url,
  language: m.language, durationMinutes: m.duration_minutes, rating: m.rating,
});

export const listMovies = (db: DB) => (db.prepare('SELECT * FROM movies ORDER BY title').all() as any[]).map(movieOut);
export const getMovie = (db: DB, id: number) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(id);
  return m ? movieOut(m) : null;
};

// available = 80 minus seats that are booked or still validly held
const AVAILABLE_SQL = `${TOTAL_SEATS} - (SELECT COUNT(*) FROM seat_locks l
  WHERE l.show_id = s.id AND (l.status = 'booked' OR l.expires_at > @now))`;

/** Only shows that have not started yet. */
export function upcomingShowsForMovie(db: DB, movieId: number, now: string) {
  return (
    db.prepare(`SELECT s.id, s.starts_at, s.ends_at, s.price, ${AVAILABLE_SQL} AS available
                FROM shows s WHERE s.movie_id = @movieId AND s.starts_at > @now ORDER BY s.starts_at`)
      .all({ movieId, now }) as any[]
  ).map((s) => ({ id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, price: s.price, availableSeats: s.available }));
}

export function getShow(db: DB, id: number, now: string) {
  const s = db
    .prepare(`SELECT s.*, ${AVAILABLE_SQL} AS available, m.title, m.poster_url, m.language, m.rating, m.duration_minutes
              FROM shows s JOIN movies m ON m.id = s.movie_id WHERE s.id = @id`)
    .get({ id, now }) as any;
  if (!s) return null;
  return {
    id: s.id, movieId: s.movie_id, startsAt: s.starts_at, endsAt: s.ends_at, price: s.price, availableSeats: s.available,
    started: s.starts_at <= now,
    movie: { title: s.title, posterUrl: s.poster_url, language: s.language, rating: s.rating, durationMinutes: s.duration_minutes },
  };
}

// ---------- admin ----------

/** One screen => any two shows whose [start, end) ranges intersect clash. */
function assertNoOverlap(db: DB, startsAt: string, endsAt: string, excludeShowId = 0) {
  const clash = db
    .prepare(`SELECT s.id, m.title FROM shows s JOIN movies m ON m.id = s.movie_id
              WHERE s.starts_at < ? AND s.ends_at > ? AND s.id != ? LIMIT 1`)
    .get(endsAt, startsAt, excludeShowId) as { id: number; title: string } | undefined;
  if (clash)
    throw new HttpError(409, `This time overlaps with another show on the screen ("${clash.title}")`, 'SHOW_OVERLAP');
}

export const createMovie = (db: DB, m: MovieInput) =>
  movieOut(
    db.prepare('SELECT * FROM movies WHERE id = ?').get(
      db
        .prepare(`INSERT INTO movies (title, description, poster_url, language, duration_minutes, rating) VALUES (?,?,?,?,?,?)`)
        .run(m.title, m.description, m.posterUrl, m.language, m.durationMinutes, m.rating).lastInsertRowid,
    ),
  );

export function updateMovie(db: DB, id: number, m: MovieInput) {
  db.transaction(() => {
    if (!getMovie(db, id)) throw new HttpError(404, 'Movie not found');
    db.prepare(`UPDATE movies SET title=?, description=?, poster_url=?, language=?, duration_minutes=?, rating=? WHERE id=?`)
      .run(m.title, m.description, m.posterUrl, m.language, m.durationMinutes, m.rating, id);
    // A new duration moves the end time of this movie's shows: re-check overlaps.
    const shows = db.prepare('SELECT id, starts_at FROM shows WHERE movie_id = ?').all(id) as { id: number; starts_at: string }[];
    for (const s of shows) {
      const end = new Date(new Date(s.starts_at).getTime() + m.durationMinutes * 60000).toISOString();
      assertNoOverlap(db, s.starts_at, end, s.id);
      db.prepare('UPDATE shows SET ends_at = ? WHERE id = ?').run(end, s.id);
    }
  }).immediate();
  return getMovie(db, id)!;
}

export function deleteMovie(db: DB, id: number) {
  db.transaction(() => {
    if (!getMovie(db, id)) throw new HttpError(404, 'Movie not found');
    const booked = db.prepare(`SELECT COUNT(*) c FROM bookings b JOIN shows s ON s.id = b.show_id WHERE s.movie_id = ?`).get(id) as { c: number };
    if (booked.c > 0) throw new HttpError(409, 'This movie has shows with bookings, so it cannot be deleted', 'HAS_BOOKINGS');
    db.prepare('DELETE FROM shows WHERE movie_id = ?').run(id); // only unbooked shows remain
    db.prepare('DELETE FROM movies WHERE id = ?').run(id);
  }).immediate();
}

export function createShow(db: DB, movieId: number, startsAtInput: string, price: number, now: string) {
  const startsAt = new Date(startsAtInput).toISOString();
  if (startsAt <= now) throw new HttpError(400, 'A show must start in the future');
  return db.transaction(() => {
    const movie = getMovie(db, movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    const endsAt = new Date(new Date(startsAt).getTime() + movie.durationMinutes * 60000).toISOString();
    assertNoOverlap(db, startsAt, endsAt);
    const id = db.prepare('INSERT INTO shows (movie_id, starts_at, ends_at, price) VALUES (?,?,?,?)').run(movieId, startsAt, endsAt, price).lastInsertRowid;
    return Number(id);
  }).immediate();
}

export function deleteShow(db: DB, id: number) {
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM shows WHERE id = ?').get(id)) throw new HttpError(404, 'Show not found');
    const c = (db.prepare('SELECT COUNT(*) c FROM bookings WHERE show_id = ?').get(id) as { c: number }).c;
    if (c > 0) throw new HttpError(409, 'This show already has bookings and cannot be deleted', 'HAS_BOOKINGS');
    db.prepare('DELETE FROM shows WHERE id = ?').run(id); // held seats cascade away
  }).immediate();
}

const STATS_SQL = `
  SELECT s.id, s.movie_id, s.starts_at, s.ends_at, s.price, m.title,
    (SELECT COUNT(*) FROM seat_locks l WHERE l.show_id = s.id AND l.status = 'booked') AS booked,
    (SELECT COALESCE(SUM(b.total_amount),0) FROM bookings b WHERE b.show_id = s.id AND b.status = 'confirmed') AS revenue
  FROM shows s JOIN movies m ON m.id = s.movie_id`;

const statsOut = (s: any) => ({
  id: s.id, movieId: s.movie_id, movieTitle: s.title, startsAt: s.starts_at, endsAt: s.ends_at, price: s.price,
  bookedSeats: s.booked, totalSeats: TOTAL_SEATS, percentFull: Math.round((s.booked / TOTAL_SEATS) * 100), revenue: s.revenue,
});

export const adminListShows = (db: DB) => (db.prepare(`${STATS_SQL} ORDER BY s.starts_at DESC`).all() as any[]).map(statsOut);

export function adminShowDetail(db: DB, id: number) {
  const s = db.prepare(`${STATS_SQL} WHERE s.id = ?`).get(id);
  if (!s) return null;
  const bookings = (
    db.prepare(`SELECT b.id, b.status, b.total_amount, b.created_at, u.name AS customer FROM bookings b
                JOIN users u ON u.id = b.user_id WHERE b.show_id = ? ORDER BY b.created_at DESC`).all(id) as any[]
  ).map((b) => ({
    id: b.id, status: b.status, customerName: b.customer, totalAmount: b.total_amount, bookedAt: b.created_at,
    seats: (db.prepare('SELECT seat_row, seat_number FROM booking_seats WHERE booking_id = ? ORDER BY seat_row, seat_number').all(b.id) as any[])
      .map((x) => `${x.seat_row}${x.seat_number}`),
  }));
  return { show: statsOut(s), bookings };
}
