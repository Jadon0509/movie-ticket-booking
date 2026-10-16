import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { BCRYPT_ROUNDS: '4' } } });
