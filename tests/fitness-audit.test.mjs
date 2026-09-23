import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditOne, runBatch, digest } from '../scripts/fitness-audit/engine.mjs';
const item={source_id:'source',revision:'revision',upstream_id:'0659',item_hash:'hash',name:'push-up (wall)',equipment:'body weight',instructions_json:JSON.stringify({en:['Shoulder height hands.'],zh:['肩高双手。']})};
const evidence={version:1,sources:[{id:'nhs',url:'https://www.nhs.uk/live-well/exercise/strength-exercises/',accessedAt:'2026-09-20',summary:'Chest level hands. 3 sets of 5 to 10.',summaryHash:digest('Chest level hands. 3 sets of 5 to 10.')}],reviews:[{upstreamId:'0659',itemHash:'hash',decision:'CONFLICTING_EVIDENCE',sourceIds:['nhs'],reason:'Dataset shoulder height differs from chest level source.',missing:['exact variant equivalence'],reviewer:'codex',independentReview:null}]};
Object.assign(evidence.reviews[0],{sourceId:item.source_id,revision:item.revision,inputHash:digest(item)});
test('evidence cannot silently approve, changed input invalidates and completed batch resumes',()=>{
 assert.equal(auditOne(item,evidence).status,'CONFLICTING_EVIDENCE');
 assert.equal(auditOne({...item,item_hash:'changed'},evidence).status,'PENDING_RESEARCH');
 assert.equal(auditOne({...item,revision:'other'},evidence).status,'PENDING_RESEARCH');
 assert.equal(auditOne({...item,instructions_json:'changed but same claimed item hash'},evidence).status,'PENDING_RESEARCH');
 const broken=structuredClone(evidence); broken.sources[0].summary+='edited'; assert.throws(()=>auditOne(item,broken),/SOURCE_HASH/);
 const unsupported=structuredClone(evidence);unsupported.reviews[0].decision='PUBLIC_EVIDENCE_COMPLETE';assert.throws(()=>auditOne(item,unsupported),/INCOMPLETE_APPROVAL/);
 Object.assign(unsupported.reviews[0],{missing:[],independentReview:{confirmed:'false',reviewer:'reviewer2'},exactVariant:{},scope:{},parameters:{},limitations:[],claims:[{sourceId:'nhs',statement:'claim',locator:'paragraph'}]});assert.throws(()=>auditOne(item,unsupported),/INCOMPLETE_APPROVAL/);
 const dir=mkdtempSync(join(tmpdir(),'fitness-audit-'));
 try{assert.equal(runBatch([item],evidence,dir,20).processed,1);assert.equal(runBatch([item],evidence,dir,20).processed,0);assert.equal(runBatch([{...item,item_hash:'changed'}],evidence,dir,20).processed,1);}finally{rmSync(dir,{recursive:true,force:true});}
});
