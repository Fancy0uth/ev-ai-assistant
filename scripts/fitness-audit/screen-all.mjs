import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch } from './engine.mjs';
const catalog=JSON.parse(readFileSync('data/fitness-audit/catalog.json','utf8'));
const evidence=JSON.parse(readFileSync('scripts/fitness-audit/pilot-evidence.json','utf8'));
const batches=[];
for(let i=0;i<=Math.ceil(catalog.length/20);i++) {
 const result=runBatch(catalog,evidence,'data/fitness-audit/results',20);
 batches.push(result);
 if(result.remainingToScreen===0)break;
}
writeFileSync('data/fitness-audit/screening-batches.json',JSON.stringify(batches,null,2)+'\n');
console.log(JSON.stringify(batches.at(-1)));
