import { loadConfig } from '../config.js';
import { PostgresRepository } from '../store/postgres.js';

const cfg = loadConfig();
if (!cfg.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const repo = new PostgresRepository(cfg.DATABASE_URL);
await repo.init();
await repo.close();
console.log('migrations applied');
