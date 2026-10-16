import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Movie } from '../types';
import Poster from '../components/Poster';
import { duration } from '../format';

export default function Home() {
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ movies: Movie[] }>('GET', '/movies').then((r) => setMovies(r.movies)).catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!movies) return <p className="muted">Loading movies…</p>;
  return (
    <>
      <h1>Now showing</h1>
      {movies.length === 0 && <p className="muted">No movies yet.</p>}
      <div className="grid">
        {movies.map((m) => (
          <Link to={`/movies/${m.id}`} className="movie-card" key={m.id}>
            <Poster url={m.posterUrl} title={m.title} />
            <div className="movie-info">
              <h3>{m.title}</h3>
              <p className="muted">{m.language} · {duration(m.durationMinutes)}</p>
              <span className={`badge rating-${m.rating}`}>{m.rating}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
