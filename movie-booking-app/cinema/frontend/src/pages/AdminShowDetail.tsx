import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { AdminBooking, AdminShow, Seat } from '../types';
import SeatMap from '../components/SeatMap';
import { bookingCode, fmtDateTime, money } from '../format';

interface Detail { show: AdminShow; bookings: AdminBooking[]; seats: Seat[] }

export default function AdminShowDetail() {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Detail>('GET', `/admin/shows/${id}`).then(setD).catch((e: ApiError) => setError(e.message));
  }, [id]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  if (error) return <div className="card"><p className="error">{error}</p><Link to="/admin">Back</Link></div>;
  if (!d) return <p className="muted">Loading…</p>;
  const { show } = d;
  return (
    <>
      <Link to="/admin" className="muted">← All shows</Link>
      <h1>{show.movieTitle}</h1>
      <p className="muted">{fmtDateTime(show.startsAt)} · {money(show.price)} per seat</p>

      <div className="stats">
        <div className="card stat"><strong>{show.bookedSeats} / {show.totalSeats}</strong><span>seats booked</span></div>
        <div className="card stat"><strong>{show.percentFull}%</strong><span>full</span></div>
        <div className="card stat"><strong>{money(show.revenue)}</strong><span>collected</span></div>
      </div>

      <div className="admin-grid">
        <div>
          <h2>Seat map</h2>
          <SeatMap seats={d.seats} readOnly />
        </div>
        <div>
          <h2>Bookings</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Customer</th><th>Seats</th><th>Booked at</th><th>Status</th></tr></thead>
              <tbody>
                {d.bookings.map((b) => (
                  <tr key={b.id} className={b.status === 'cancelled' ? 'past' : ''}>
                    <td>{bookingCode(b.id)}</td><td>{b.customerName}</td><td>{b.seats.join(', ')}</td>
                    <td>{fmtDateTime(b.bookedAt)}</td><td>{b.status}</td>
                  </tr>
                ))}
                {d.bookings.length === 0 && <tr><td colSpan={5} className="muted">No bookings yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
