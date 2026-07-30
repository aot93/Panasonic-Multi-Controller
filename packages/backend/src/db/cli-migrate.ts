import { getDb, closeDb } from './index.js';
import { DB_PATH } from '../config.js';

// getDb() runs pending migrations as part of opening the database.
getDb();
console.log(`[db] up to date at ${DB_PATH}`);
closeDb();
