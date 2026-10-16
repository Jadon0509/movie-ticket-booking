import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError } from '../errors';
import { getMovie, getShow, listMovies, upcomingShowsForMovie } from '../services/shows';
import { getSeatMap, holdSeats, releaseHold } from '../services/seats';
import { cancelBooking, checkout, getBookingForUser, listBookingsForUser } from '../services/bookings';
import { idParam, nowIso, parse } from './util';

export function customerRoutes(db: DB, requireAuth: any) {
  const r = Router();

  // ---- public catalogue (flow 2) ----
  r.get('/movies', (_req, res) => res.json({ movies: listMovies(db) }));
  r.get('/movies/:id', (req, res) => {
    const movie = getMovie(db, idParam(req));
    if (!movie) throw new HttpError(404, 'Movie not found');
    res.json({ movie, shows: upcomingShowsForMovie(db, movie.id, nowIso()) });
  });
  r.get('/shows/:id', (req, res) => {
    const show = getShow(db, idParam(req), nowIso());
    if (!show) throw new HttpError(404, 'Show not found');
    res.json({ show });
  });

  // ---- everything below needs a valid login (enforced here, not just in the UI) ----
  r.get('/shows/:id/seats', requireAuth, (req, res) => {
    const showId = idParam(req);
    const now = nowIso();
    const show = getShow(db, showId, now);
    if (!show) throw new HttpError(404, 'Show not found');
    res.json({ show, ...getSeatMap(db, showId, req.user!.id, now), serverTime: now });
  });

  r.post('/shows/:id/hold', requireAuth, (req, res) => {
    const out = holdSeats(db, req.user!.id, idParam(req), req.body?.seats, nowIso());
    res.status(201).json(out);
  });
  r.delete('/shows/:id/hold', requireAuth, (req, res) => {
    releaseHold(db, req.user!.id, idParam(req));
    res.status(204).end();
  });

  r.post('/shows/:id/checkout', requireAuth, (req, res) => {
    const { outcome } = parse(z.object({ outcome: z.enum(['success', 'failure']) }), req.body);
    const booking = checkout(db, req.user!.id, idParam(req), outcome, nowIso());
    res.status(201).json({ booking });
  });

  r.get('/bookings', requireAuth, (req, res) => res.json({ bookings: listBookingsForUser(db, req.user!.id, nowIso()) }));
  r.get('/bookings/:id', requireAuth, (req, res) => {
    const b = getBookingForUser(db, req.user!.id, idParam(req));
    if (!b) throw new HttpError(404, 'Booking not found');
    res.json({ booking: b });
  });
  r.post('/bookings/:id/cancel', requireAuth, (req, res) =>
    res.json({ booking: cancelBooking(db, req.user!.id, idParam(req), nowIso()) }),
  );
  return r;
}
