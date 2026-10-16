export const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const duration = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
export const bookingCode = (id: number) => `BK-${String(id).padStart(6, '0')}`;
/** YYYY-MM-DD in the viewer's local timezone, used to group shows by day. */
export const localDayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
