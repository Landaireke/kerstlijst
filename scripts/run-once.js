// Eén ronde draaien (handig voor een externe cron job of om te testen): npm run agent [-- item-id]
import 'dotenv/config';
import { runAll } from '../src/agent/index.js';
import { init } from '../src/db.js';

await init();

const only = process.argv[2];
runAll({ only })
  .then((r) => {
    console.table(r);
    process.exit(r.some((x) => !x.ok) ? 1 : 0);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
