import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { AdminShow, Movie } from '../types';
import { fmtDateTime, money } from '../format';

export default function AdminShows() {
  const [shows, setShows] = useState<AdminShow[] | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(() => {
    api<{ shows: AdminShow[] }>('GET', '/admin/shows').then((r) => setShows(r.shows)).catch((e: ApiError) => setError(e.message));
    api<{ movies: Movie[] }>('GET', '/movies').then((r) => setMovies(r.movies));
  }, []);
  useEffect(load, [load]);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(''); setOk('');
    try {
      // The browser gives local date + time; convert to a UTC instant before sending.
      const startsAt = new Date(`${f.get('date')}T${f.get('time')}`).toISOString();
      await api('POST', '/admin/shows', { movieId: Number(f.get('movieId')), startsAt, price: Number(f.get('price')) });
      setOk('Show added.'); load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not add show'); }
  };

  const del = async (s: AdminShow) => {
    if (!confirm(`Delete the ${fmtDateTime(s.startsAt)} show of ${s.movieTitle}?`)) return;
    setError(''); setOk('');
    try { await api('DELETE', `/admin/shows/${s.id}`); setOk('Show deleted.'); load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not delete'); }
  };

  const now = new Date().toISOString();
  return (
    <>
      <h1>Shows</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {ok && <p className="info">{ok}</p>}

      <form className="card inline-form" onSubmit={add}>
        <h2>Add a show</h2>
        <label>Movie
          <select name="movieId" required>{movies.map((m) => <option key={m.id} value={m.id}>{m.title} ({m.durationMinutes} min)</option>)}</select>
        </label>
        <label>Date<input type="date" name="date" required /></label>
        <label>Start time<input type="time" name="time" required /></label>
        <label>Price (₹)<input type="number" name="price" min={1} step={1} defaultValue={200} required /></label>
        <button className="btn" disabled={movies.length === 0}>Add show</button>
      </form>

      {!shows ? <p className="muted">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Movie</th><th>Starts</th><th>Price</th><th>Booked</th><th>Full</th><th>Collected</th><th></th></tr></thead>
            <tbody>
              {shows.map((s) => (
                <tr key={s.id} className={s.startsAt < now ? 'past' : ''}>
                  <td>{s.movieTitle}</td>
                  <td>{fmtDateTime(s.startsAt)}{s.startsAt < now && <small className="muted"> (past)</small>}</td>
                  <td>{money(s.price)}</td>
                  <td>{s.bookedSeats} / {s.totalSeats}</td>
                  <td><div className="bar"><div style={{ width: `${s.percentFull}%` }} /></div>{s.percentFull}%</td>
                  <td>{money(s.revenue)}</td>
                  <td className="actions">
                    <Link className="btn small secondary" to={`/admin/shows/${s.id}`}>Open</Link>
                    <button className="btn small danger" onClick={() => del(s)}>Delete</button>
                  </td>
                </tr>
              ))}
              {shows.length === 0 && <tr><td colSpan={7} className="muted">No shows yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
