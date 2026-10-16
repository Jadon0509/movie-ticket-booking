import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import type { Booking, SeatMapResponse } from '../types';
import SeatMap from '../components/SeatMap';
import { bookingCode, fmtDateTime, money, mmss } from '../format';

const MAX_SEATS = 6;
const POLL_MS = 3000; // flow 10: seat map refreshes itself every 3 seconds

interface LocalHold { seats: string[]; expiresAtLocal: number } // expiry in *this browser's* clock

export default function ShowBooking() {
  const { id } = useParams();
  const [data, setData] = useState<SeatMapResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [hold, setHold] = useState<LocalHold | null>(null);
  const [now, setNow] = useState(Date.now());
  const [payOpen, setPayOpen] = useState(false);
  const [payFailed, setPayFailed] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);

  // refs let the polling callback see the latest values without re-subscribing
  const clockOffset = useRef(0); // serverTime - browserTime
  const holdRef = useRef<LocalHold | null>(null);
  const actionSeq = useRef(0); // bumped on every hold/release/pay so slow poll responses can be ignored
  holdRef.current = hold;

  const load = useCallback(async () => {
    const seq = actionSeq.current;
    try {
      const r = await api<SeatMapResponse>('GET', `/shows/${id}/seats`);
      if (seq !== actionSeq.current) return; // stale: an action happened while this request was in flight
      clockOffset.current = Date.parse(r.serverTime) - Date.now();
      setData(r);
      setLoadError('');
      // Only keep selected seats that are still free (someone else may have taken them).
      setSelected((prev) => {
        const free = new Set(r.seats.filter((s) => s.status === 'available').map((s) => s.label));
        const next = new Set([...prev].filter((l) => free.has(l)));
        return next.size === prev.size ? prev : next;
      });
      if (r.myHold) {
        setHold({ seats: r.myHold.seats, expiresAtLocal: Date.parse(r.myHold.expiresAt) - clockOffset.current });
      } else if (holdRef.current) {
        setHold(null); setPayOpen(false);
        setMsg({ kind: 'error', text: 'Your seat hold expired. Please select your seats again.' });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) setLoadError(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Polling (flow 10). Skips while the tab is hidden and stops once booked.
  useEffect(() => {
    if (booking) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, booking]);

  // Countdown. When it reaches zero the hold is gone on the server too, so refresh.
  useEffect(() => {
    if (!hold) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [hold]);
  useEffect(() => {
    if (hold && now >= hold.expiresAtLocal) {
      setHold(null); setPayOpen(false);
      setMsg({ kind: 'error', text: 'Time is up. Your seats were released.' });
      load();
    }
  }, [now, hold, load]);

  if (loadError) return <div className="card"><p className="error">{loadError}</p><Link to="/">Back to movies</Link></div>;
  if (!data) return <p className="muted">Loading seat map…</p>;

  const { show } = data;
  const price = show.price;

  const toggle = (label: string) => {
    setMsg(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else if (next.size >= MAX_SEATS) { setMsg({ kind: 'error', text: `You can select at most ${MAX_SEATS} seats.` }); return prev; }
      else next.add(label);
      return next;
    });
  };

  const sortSeats = (l: Iterable<string>) => [...l].sort((a, b) => a[0].localeCompare(b[0]) || Number(a.slice(1)) - Number(b.slice(1)));

  const doHold = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ seats: string[]; expiresAt: string }>('POST', `/shows/${id}/hold`, { seats: sortSeats(selected) });
      actionSeq.current++;
      setHold({ seats: r.seats, expiresAtLocal: Date.parse(r.expiresAt) - clockOffset.current });
      setNow(Date.now());
      setSelected(new Set());
    } catch (e) {
      if (e instanceof ApiError) {
        setMsg({ kind: 'error', text: e.message });
        if (e.code === 'SEAT_TAKEN') setSelected((p) => new Set([...p].filter((l) => !(e.body?.seats ?? []).includes(l))));
      }
    } finally { setBusy(false); load(); }
  };

  const release = async () => {
    setBusy(true);
    try { await api('DELETE', `/shows/${id}/hold`); } catch { /* ignore */ }
    actionSeq.current++;
    setHold(null); setPayOpen(false); setBusy(false); setMsg(null); load();
  };

  const doPay = async (outcome: 'success' | 'failure') => {
    setBusy(true);
    try {
      const r = await api<{ booking: Booking }>('POST', `/shows/${id}/checkout`, { outcome });
      actionSeq.current++;
      setBooking(r.booking); setHold(null); setPayOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PAYMENT_FAILED') setPayFailed(true);
      else if (e instanceof ApiError) {
        setPayOpen(false); setHold(null);
        setMsg({ kind: 'error', text: e.message });
        load();
      }
    } finally { setBusy(false); }
  };

  // ---------- confirmation screen ----------
  if (booking) {
    return (
      <div className="card narrow success">
        <h1>✅ Booking confirmed</h1>
        <dl className="details">
          <dt>Booking ID</dt><dd><strong>{bookingCode(booking.id)}</strong></dd>
          <dt>Movie</dt><dd>{booking.movie.title}</dd>
          <dt>Date &amp; time</dt><dd>{fmtDateTime(booking.startsAt)}</dd>
          <dt>Seats</dt><dd>{booking.seats.join(', ')}</dd>
          <dt>Amount paid</dt><dd>{money(booking.totalAmount)}</dd>
        </dl>
        <div className="row">
          <Link className="btn" to="/bookings">View my bookings</Link>
          <Link className="btn secondary" to="/">Book another movie</Link>
        </div>
      </div>
    );
  }

  const selectedList = sortSeats(selected);
  const remaining = hold ? hold.expiresAtLocal - now : 0;

  return (
    <>
      <div className="show-header">
        <div>
          <h1>{show.movie.title}</h1>
          <p className="muted">{fmtDateTime(show.startsAt)} · {show.movie.language} · {money(price)} per seat · {data.availableCount} seats left</p>
        </div>
        <Link to={`/movies/${show.movieId}`} className="muted">← All shows</Link>
      </div>

      {show.started && <p className="error">This show has already started. Booking is closed.</p>}
      {msg && <p className={msg.kind === 'error' ? 'error' : 'info'} role="alert">{msg.text}</p>}

      <div className="booking-layout">
        <SeatMap
          seats={data.seats}
          selected={selected}
          onToggle={toggle}
          readOnly={!!hold || show.started}
        />

        <aside className="card summary">
          {hold ? (
            <>
              <h2>Seats held for you</h2>
              <p className="seats-line">{sortSeats(hold.seats).join(', ')}</p>
              <p className={`timer ${remaining < 60000 ? 'urgent' : ''}`} aria-live="polite">⏱ {mmss(remaining)} left</p>
              <p className="total">Total: <strong>{money(price * hold.seats.length)}</strong></p>
              <button className="btn" disabled={busy} onClick={() => { setPayFailed(false); setPayOpen(true); }}>Pay {money(price * hold.seats.length)}</button>
              <button className="btn secondary" disabled={busy} onClick={release}>Release seats</button>
            </>
          ) : (
            <>
              <h2>Your selection</h2>
              <p className="seats-line">{selectedList.length ? selectedList.join(', ') : <span className="muted">No seats selected</span>}</p>
              <p className="muted">Select 1 to {MAX_SEATS} seats.</p>
              <p className="total">Total: <strong>{money(price * selectedList.length)}</strong></p>
              <button className="btn" disabled={busy || selectedList.length === 0 || show.started} onClick={doHold}>
                {busy ? 'Holding…' : 'Continue'}
              </button>
              <p className="muted small">Seats are held for 5 minutes once you continue.</p>
            </>
          )}
        </aside>
      </div>

      {payOpen && hold && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Payment">
          <div className="modal">
            {payFailed ? (
              <>
                <h2 className="error-title">❌ Payment failed</h2>
                <p>Your payment did not go through. Your seats are still held for <strong>{mmss(remaining)}</strong>.</p>
                <div className="row">
                  <button className="btn" onClick={() => setPayFailed(false)}>Try again</button>
                  <button className="btn secondary" onClick={() => setPayOpen(false)}>Close</button>
                </div>
              </>
            ) : (
              <>
                <h2>Payment (demo)</h2>
                <p>Amount: <strong>{money(price * hold.seats.length)}</strong> for {sortSeats(hold.seats).join(', ')}</p>
                <p className={`timer ${remaining < 60000 ? 'urgent' : ''}`}>⏱ {mmss(remaining)} left</p>
                <p className="muted small">No real money is used. Choose an outcome to test:</p>
                <div className="row">
                  <button className="btn success-btn" disabled={busy} onClick={() => doPay('success')}>Payment success</button>
                  <button className="btn danger" disabled={busy} onClick={() => doPay('failure')}>Payment failure</button>
                </div>
                <button className="link-btn" onClick={() => setPayOpen(false)}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
