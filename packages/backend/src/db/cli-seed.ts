import { getDb, closeDb } from './index.js';
import { seed } from './seed.js';

seed(getDb());
closeDb();
