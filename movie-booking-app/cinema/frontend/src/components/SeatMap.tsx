import type { Seat } from '../types';

interface Props {
  seats: Seat[];
  selected?: Set<string>;
  onToggle?: (label: string) => void;
  /** true = nothing is clickable (admin view, or while seats are held) */
  readOnly?: boolean;
}

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const TITLE: Record<string, string> = { available: 'Available', held: 'Held by someone else', booked: 'Booked', mine: 'Held for you' };

export default function SeatMap({ seats, selected = new Set(), onToggle, readOnly }: Props) {
  const byRow = (r: string) => seats.filter((s) => s.row === r);
  return (
    <div className="seatmap">
      <div className="screen">Screen this way</div>
      {ROWS.map((r) => (
        <div className="seat-row" key={r}>
          <span className="row-label">{r}</span>
          {byRow(r).map((s) => {
            const isSel = selected.has(s.label);
            const cls = isSel ? 'selected' : s.status;
            const clickable = !readOnly && s.status === 'available';
            return (
              <button
                key={s.label}
                type="button"
                className={`seat ${cls}`}
                disabled={!clickable}
                aria-pressed={isSel}
                aria-label={`Seat ${s.label}, ${isSel ? 'selected' : TITLE[s.status]}`}
                title={`${s.label}: ${isSel ? 'Selected' : TITLE[s.status]}`}
                onClick={() => onToggle?.(s.label)}
              >
                {s.number}
              </button>
            );
          })}
          <span className="row-label">{r}</span>
        </div>
      ))}
      <div className="legend">
        <span><i className="seat available" /> Available</span>
        <span><i className="seat selected" /> Selected / yours</span>
        <span><i className="seat held" /> Held by someone else</span>
        <span><i className="seat booked" /> Booked</span>
      </div>
    </div>
  );
}
