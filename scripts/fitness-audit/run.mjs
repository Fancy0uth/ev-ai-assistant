import { readFileSync } from 'node:fs';
import { runBatch } from './engine.mjs';
const [catalog, evidence, output, limit = '20'] = process.argv.slice(2);
if (!catalog || !evidence || !output) throw Error('Usage: node scripts/fitness-audit/run.mjs catalog.json evidence.json output-dir [batch-size<=20]');
console.log(JSON.stringify(runBatch(JSON.parse(readFileSync(catalog, 'utf8')), JSON.parse(readFileSync(evidence, 'utf8')), output, Number(limit))));
