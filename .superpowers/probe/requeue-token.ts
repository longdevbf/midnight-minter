import { resolve } from 'node:path';
import Database from 'better-sqlite3';
const db = new Database(resolve('data/minter.db'));
console.log(db.prepare("update tokens set status='queued', failed_step=null, message=null where id=? and status='failed'").run('ec5981c5-936d-4c5f-a480-24e324a966ee'));
