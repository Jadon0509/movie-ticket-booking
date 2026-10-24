import { createApp } from './app';
import { config } from './config';
import { openDb } from './db';

if (config.jwtSecret === 'dev-only-secret-change-me') console.warn('! Using the default JWT secret. Set JWT_SECRET in production.');

try {
  const db = openDb(config.dbPath);
  console.log(`Database: ${config.dbPath}`);
  createApp(db)
    .listen(config.port, () => console.log(`API running on http://localhost:${config.port}`))
    .on('error', (e: NodeJS.ErrnoException) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Close the other backend or set PORT.` : e);
      process.exit(1);
    });
} catch (e) {
  console.error('Could not start the backend:', e);
  process.exit(1);
}
