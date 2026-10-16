export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath: process.env.DB_PATH ?? new URL('../data/cinema.db', import.meta.url).pathname,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
};

// Business rules live in one place so they are easy to find and explain.
export const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const SEATS_PER_ROW = 10;
export const TOTAL_SEATS = ROWS.length * SEATS_PER_ROW; // 80
export const HOLD_MS = 5 * 60 * 1000; // seats are held for 5 minutes
export const MAX_SEATS_PER_BOOKING = 6;
export const CANCEL_CUTOFF_MS = 2 * 60 * 60 * 1000; // no cancelling within 2h of show
