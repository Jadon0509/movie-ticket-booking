import { createApp } from './app';
import { config } from './config';
import { openDb } from './db';

if (config.jwtSecret === 'dev-only-secret-change-me') console.warn('! Using the default JWT secret. Set JWT_SECRET in production.');
const db = openDb(config.dbPath);
createApp(db).listen(config.port, () => console.log(`API running on http://localhost:${config.port}`));
