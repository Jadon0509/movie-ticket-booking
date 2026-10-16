import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Booking } from '../types';
import { bookingCode, fmtDateTime, money } from '../format';

const CUTOFF_MS = 2 * 60 * 60 * 1000;

export default function MyBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<{ bookings: Booking[] }>('GET', '/bookings').then((r) => setBookings(r.bookings)).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const cancel = async (b: Booking) => {
    if (!confirm(`Cancel booking ${bookingCode(b.id)} for ${b.movie.title}?`)) return;
    setError(''); setNotice('');
    try {
      await api('POST', `/bookings/${b.id}/cancel`);
      setNotice(`Booking ${bookingCode(b.id)} was cancelled.`);
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not cancel'); }
  };

  if (!bookings) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const now = Date.now();
  const upcoming = bookings.filter((b) => Date.parse(b.startsAt) > now);
  const past = bookings.filter((b) => Date.parse(b.startsAt) <= now);

  const Card = ({ b }: { b: Booking }) => {
    const canCancel = b.status === 'confirmed' && Date.parse(b.startsAt) - now >= CUTOFF_MS;
    return (
      <div className={`card booking ${b.status}`}>
        <div className="row between">
          <h3>{b.movie.title}</h3>
          <span className={`badge status-${b.status}`}>{b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}</span>
        </div>
        <dl className="details">
          <dt>Booking ID</dt><dd>{bookingCode(b.id)}</dd>
          <dt>Show</dt><dd>{fmtDateTime(b.startsAt)}</dd>
          <dt>Seats</dt><dd>{b.seats.join(', ')}</dd>
          <dt>Amount</dt><dd>{money(b.totalAmount)}</dd>
        </dl>
        {b.status === 'confirmed' && Date.parse(b.startsAt) > now && (
          <button className="btn small danger" onClick={() => cancel(b)} disabled={!canCancel}
            title={canCancel ? '' : 'Cancellation closes 2 hours before the show'}>
            {canCancel ? 'Cancel booking' : 'Cancellation closed (under 2h)'}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <h1>My bookings</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="info">{notice}</p>}
      {bookings.length === 0 && <div className="card"><p>You have no bookings yet.</p><Link to="/">Browse movies</Link></div>}
      {upcoming.length > 0 && <><h2>Upcoming</h2><div className="cards">{upcoming.map((b) => <Card key={b.id} b={b} />)}</div></>}
      {past.length > 0 && <><h2>Past</h2><div className="cards">{past.map((b) => <Card key={b.id} b={b} />)}</div></>}
    </>
  );
}
