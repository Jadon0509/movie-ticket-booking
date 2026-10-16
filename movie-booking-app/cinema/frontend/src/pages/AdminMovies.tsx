import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { Movie } from '../types';
import { duration } from '../format';

const EMPTY = { title: '', description: '', posterUrl: '', language: 'Hindi', durationMinutes: 120, rating: 'UA' as Movie['rating'] };

export default function AdminMovies() {
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [editing, setEditing] = useState<Movie | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(() => { api<{ movies: Movie[] }>('GET', '/movies').then((r) => setMovies(r.movies)); }, []);
  useEffect(load, [load]);

  const startEdit = (m: Movie | null) => {
    setEditing(m); setError(''); setOk('');
    setForm(m ? { title: m.title, description: m.description, posterUrl: m.posterUrl, language: m.language, durationMinutes: m.durationMinutes, rating: m.rating } : EMPTY);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setOk('');
    try {
      if (editing) await api('PUT', `/admin/movies/${editing.id}`, form);
      else await api('POST', '/admin/movies', form);
      setOk(editing ? 'Movie updated.' : 'Movie added.');
      startEdit(null); load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); }
  };

  const del = async (m: Movie) => {
    if (!confirm(`Delete "${m.title}" and its (unbooked) shows?`)) return;
    setError(''); setOk('');
    try { await api('DELETE', `/admin/movies/${m.id}`); setOk('Movie deleted.'); load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not delete'); }
  };

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: k === 'durationMinutes' ? Number(e.target.value) : e.target.value }));

  return (
    <>
      <h1>Movies</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {ok && <p className="info">{ok}</p>}

      <form className="card inline-form" onSubmit={save}>
        <h2>{editing ? `Edit "${editing.title}"` : 'Add a movie'}</h2>
        <label>Title<input value={form.title} onChange={set('title')} required maxLength={200} /></label>
        <label>Language<input value={form.language} onChange={set('language')} required /></label>
        <label>Duration (min)<input type="number" min={1} max={600} value={form.durationMinutes} onChange={set('durationMinutes')} required /></label>
        <label>Rating
          <select value={form.rating} onChange={set('rating')}><option>U</option><option>UA</option><option>A</option></select>
        </label>
        <label className="wide">Poster URL (optional)<input value={form.posterUrl} onChange={set('posterUrl')} placeholder="https://…" /></label>
        <label className="wide">Description<textarea value={form.description} onChange={set('description')} rows={2} /></label>
        <div className="row">
          <button className="btn">{editing ? 'Save changes' : 'Add movie'}</button>
          {editing && <button type="button" className="btn secondary" onClick={() => startEdit(null)}>Cancel edit</button>}
        </div>
      </form>

      {!movies ? <p className="muted">Loading…</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Language</th><th>Duration</th><th>Rating</th><th></th></tr></thead>
            <tbody>
              {movies.map((m) => (
                <tr key={m.id}>
                  <td>{m.title}</td><td>{m.language}</td><td>{duration(m.durationMinutes)}</td><td>{m.rating}</td>
                  <td className="actions">
                    <button className="btn small secondary" onClick={() => startEdit(m)}>Edit</button>
                    <button className="btn small danger" onClick={() => del(m)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
