import bcrypt from 'bcryptjs';
import { config } from './config';
import { openDb } from './db';

// Run with: npm run seed   (safe to run more than once)
const db = openDb(config.dbPath);

export const ADMIN = { name: 'Cinema Admin', email: 'admin@cinema.test', password: 'Admin@1234' };
export const CUSTOMER = { name: 'Test Customer', email: 'customer@cinema.test', password: 'Customer@123' };

function upsertUser(u: { name: string; email: string; password: string }, role: 'admin' | 'customer') {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(u.email)) return;
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(u.name, u.email, bcrypt.hashSync(u.password, config.bcryptRounds), role);
}
upsertUser(ADMIN, 'admin'); // the ONLY way an admin gets created
upsertUser(CUSTOMER, 'customer');

if ((db.prepare('SELECT COUNT(*) c FROM movies').get() as { c: number }).c === 0) {
  const movies = [
    ['The Last Monsoon', 'A retired cartographer returns to her village as the final monsoon of the decade arrives.', 'Hindi', 142, 'UA'],
    ['Code Red Bangalore', 'A night-shift engineer discovers a conspiracy hidden inside a city-wide power grid.', 'Hindi', 128, 'UA'],
    ['Little Chai Stall', 'A heart-warming comedy about three generations running a roadside tea stall.', 'Hindi', 105, 'U'],
    ['Midnight Local', 'A thriller set entirely on the last suburban train out of the city.', 'English', 118, 'A'],
    ['Ocean of Stars', 'Two kids build a rocket from scrap and chase a comet across the coast.', 'English', 96, 'U'],
  ] as const;
  const insM = db.prepare('INSERT INTO movies (title, description, language, duration_minutes, rating) VALUES (?,?,?,?,?)');
  const ids = movies.map((m) => Number(insM.run(...m).lastInsertRowid));

  // Four non-overlapping slots a day for the next 5 days (server local time).
  const slots = [[10, 0], [13, 30], [17, 0], [20, 30]];
  const insS = db.prepare('INSERT INTO shows (movie_id, starts_at, ends_at, price) VALUES (?,?,?,?)');
  let k = 0;
  for (let day = 0; day < 5; day++) {
    for (const [h, min] of slots) {
      const idx = k++ % ids.length;
      const start = new Date();
      start.setDate(start.getDate() + day);
      start.setHours(h, min, 0, 0);
      if (start.getTime() < Date.now() + 30 * 60000) continue; // keep seeded shows in the future
      const end = new Date(start.getTime() + movies[idx][3] * 60000);
      insS.run(ids[idx], start.toISOString(), end.toISOString(), [180, 220, 250, 300][idx % 4]);
    }
  }
}
db.prepare('INSERT OR IGNORE INTO damaged_seats (seat_row, seat_number, reason, marked_at) VALUES (?,?,?,?)')
  .run('H', 10, 'Broken recliner', new Date().toISOString()); // demo: seat H10 is damaged
console.log('Seeded.\n  Admin:    %s / %s\n  Customer: %s / %s', ADMIN.email, ADMIN.password, CUSTOMER.email, CUSTOMER.password);
