// Plain SQL, no ORM: the constraints below are what actually protect the data.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS movies (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  poster_url       TEXT NOT NULL DEFAULT '',
  language         TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
  rating           TEXT NOT NULL CHECK (rating IN ('U','UA','A'))
);

-- One screen only. starts_at / ends_at are UTC ISO-8601 strings, so plain
-- string comparison orders them correctly. ends_at = starts_at + movie duration.
CREATE TABLE IF NOT EXISTS shows (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  movie_id  INTEGER NOT NULL REFERENCES movies(id),
  starts_at TEXT NOT NULL,
  ends_at   TEXT NOT NULL,
  price     INTEGER NOT NULL CHECK (price > 0),   -- whole rupees per seat
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_shows_starts_at ON shows(starts_at);

CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  show_id      INTEGER NOT NULL REFERENCES shows(id),
  total_amount INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at   TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_show ON bookings(show_id);

-- Permanent record of which seats a booking had (survives cancellation).
CREATE TABLE IF NOT EXISTS booking_seats (
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_row    TEXT    NOT NULL CHECK (seat_row IN ('A','B','C','D','E','F','G','H')),
  seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  PRIMARY KEY (booking_id, seat_row, seat_number)
);

-- THE anti-double-booking table. A row means "this seat is taken for this show"
-- (either temporarily held, or booked). The PRIMARY KEY (show_id, seat_row,
-- seat_number) makes it physically impossible for two rows to exist for the
-- same seat, whatever the application code does.
CREATE TABLE IF NOT EXISTS seat_locks (
  show_id     INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_row    TEXT    NOT NULL CHECK (seat_row IN ('A','B','C','D','E','F','G','H')),
  seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT    NOT NULL CHECK (status IN ('held','booked')),
  booking_id  INTEGER REFERENCES bookings(id),
  expires_at  TEXT,                                -- only for held rows
  PRIMARY KEY (show_id, seat_row, seat_number),
  CHECK (
    (status = 'held'   AND expires_at IS NOT NULL AND booking_id IS NULL) OR
    (status = 'booked' AND booking_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_seat_locks_user ON seat_locks(user_id, show_id);

-- Seats that are physically broken. One screen => a damaged seat is damaged for
-- every show, so this table has no show_id. Customers can never hold these.
CREATE TABLE IF NOT EXISTS damaged_seats (
  seat_row    TEXT    NOT NULL CHECK (seat_row IN ('A','B','C','D','E','F','G','H')),
  seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  reason      TEXT    NOT NULL DEFAULT '',
  marked_at   TEXT    NOT NULL,
  PRIMARY KEY (seat_row, seat_number)
);
`;
