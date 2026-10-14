import { resolve } from 'node:path';
import Database from 'better-sqlite3';
const db = new Database(resolve('data/minter.db'));
console.log(db.prepare("select deploy_tx_id, contract_address from tokens where id=?").get('ec5981c5-936d-4c5f-a480-24e324a966ee'));
console.log(db.prepare("update tokens set status='done', failed_step=null, message=null, mint_tx_id=?, token_color=? where id=? and contract_address is not null").run('005641bed2fb74cbfea4690e11f1085ca6438cade6ee075d4815ba23b17c63d138', '0693f95a57376da28654dfcf008826c15bbfb3a7efccb54c6a7c0b0851363650', 'ec5981c5-936d-4c5f-a480-24e324a966ee'));
