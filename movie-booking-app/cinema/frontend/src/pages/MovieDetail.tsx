import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Movie, ShowSummary } from '../types';
import Poster from '../components/Poster';
import { duration, fmtDate, fmtTime, localDayKey, money } from '../format';

export default function MovieDetail() {
  const { id } = useParams();
  const [data, setData] = useState<{ movie: Movie; shows: ShowSummary[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('GET', `/movies/${id}`).then(setData).catch((e: ApiError) => setError(e.message));
  }, [id]);

  if (error) return <div className="card"><p className="error">{error}</p><Link to="/">Back to movies</Link></div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { movie, shows } = data;
  const days = new Map<string, ShowSummary[]>();
  shows.forEach((s) => { const k = localDayKey(s.startsAt); days.set(k, [...(days.get(k) ?? []), s]); });

  return (
    <div className="detail">
      <Poster url={movie.posterUrl} title={movie.title} className="big" />
      <div>
        <h1>{movie.title}</h1>
        <p className="muted">{movie.language} · {duration(movie.durationMinutes)} · <span className={`badge rating-${movie.rating}`}>{movie.rating}</span></p>
        <p>{movie.description || 'No description available.'}</p>

        <h2>Upcoming shows</h2>
        {shows.length === 0 && <p className="muted">No upcoming shows for this movie.</p>}
        {[...days.entries()].map(([key, list]) => (
          <div className="day" key={key}>
            <h3>{fmtDate(list[0].startsAt)}</h3>
            <div className="show-list">
              {list.map((s) => (
                <Link key={s.id} to={`/shows/${s.id}`} className={`show-chip ${s.availableSeats === 0 ? 'soldout' : ''}`}>
                  <strong>{fmtTime(s.startsAt)}</strong>
                  <span>{money(s.price)}</span>
                  <small>{s.availableSeats === 0 ? 'Sold out' : `${s.availableSeats} seats left`}</small>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
