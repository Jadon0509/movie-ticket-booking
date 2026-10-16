import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError } from '../errors';
import { getSeatMap } from '../services/seats';
import {
  adminListShows, adminShowDetail, createMovie, createShow, deleteMovie, deleteShow, updateMovie,
} from '../services/shows';
import { idParam, nowIso, parse } from './util';

const movieSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).default(''),
  posterUrl: z.string().trim().refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Poster must be an http(s) URL or empty').default(''),
  language: z.string().trim().min(1, 'Language is required').max(50),
  durationMinutes: z.coerce.number().int('Duration must be a whole number').min(1).max(600, 'Duration must be 1-600 minutes'),
  rating: z.enum(['U', 'UA', 'A'], { message: 'Rating must be U, UA or A' }),
});
const showSchema = z.object({
  movieId: z.coerce.number().int().min(1, 'Choose a movie'),
  startsAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time'),
  price: z.coerce.number().int('Price must be a whole number').min(1, 'Price must be at least 1'),
});

export function adminRoutes(db: DB, requireAdmin: any) {
  const r = Router();
  r.use(requireAdmin); // every route in this file is admin-only

  r.post('/movies', (req, res) => res.status(201).json({ movie: createMovie(db, parse(movieSchema, req.body)) }));
  r.put('/movies/:id', (req, res) => res.json({ movie: updateMovie(db, idParam(req), parse(movieSchema, req.body)) }));
  r.delete('/movies/:id', (req, res) => { deleteMovie(db, idParam(req)); res.status(204).end(); });

  r.get('/shows', (_req, res) => res.json({ shows: adminListShows(db) }));
  r.post('/shows', (req, res) => {
    const b = parse(showSchema, req.body);
    const id = createShow(db, b.movieId, b.startsAt, b.price, nowIso());
    res.status(201).json({ id });
  });
  r.delete('/shows/:id', (req, res) => { deleteShow(db, idParam(req)); res.status(204).end(); });

  // flow 9: stats + bookings list + the same seat map customers see
  r.get('/shows/:id', (req, res) => {
    const id = idParam(req);
    const detail = adminShowDetail(db, id);
    if (!detail) throw new HttpError(404, 'Show not found');
    res.json({ ...detail, ...getSeatMap(db, id, null, nowIso()) });
  });
  return r;
}
