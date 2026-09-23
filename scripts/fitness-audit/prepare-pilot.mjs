import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './engine.mjs';
const rows=JSON.parse(readFileSync('data/fitness-audit/catalog.json','utf8'));
const sources=[
 ['nhs-strength','https://www.nhs.uk/live-well/exercise/strength-exercises/','2024-02-28','NHS: floor calf raises with chair support, five repetitions; wall press-up uses chest-height hands and three sets of five to ten. Mini-squats use chair support, comfortable depth and five repetitions. Start gradually.'],
 ['mayo-pushup','https://www.mayoclinic.org/healthy-lifestyle/fitness/multimedia/modified-pushup/vid-20084674','2025-11-21','Mayo Clinic: modified pushup rests on hands and knees. Wall variant uses shoulder-height hands, slightly wider than shoulders. Keep trunk straight and move under control. No numeric dose is supplied.'],
 ['ace-pushup','https://www.acefitness.org/resources/everyone/exercise-library/41/push-up/',null,'ACE lists floor push-up as intermediate and no equipment, with shoulder-width hands, straight body and controlled lowering/raising. Elbow variation is described; no numeric dose for pilot variants.'],
 ['mayo-squat','https://www.mayoclinic.org/healthy-lifestyle/fitness/multimedia/squat/vid-20084663','2025-11-21','Controlled bilateral bodyweight squat, neutral spine, aligned knees and depth within capability. One set of twelve to fifteen suits most people; stop on fatigue or form deterioration. Not a pistol, twist or jump prescription.'],
 ['mayo-lunge','https://www.mayoclinic.org/healthy-lifestyle/fitness/multimedia/lunge/vid-20084662','2025-11-21','Stationary and traveling lunges, neutral spine, controlled knee alignment. Repetitions depend on fitness; stop on fatigue or form deterioration. No fixed numeric dose or rotating variant.'],
 ['mayo-bridge','https://www.mayoclinic.org/healthy-lifestyle/adult-health/in-depth/back-pain/art-20546859',null,'Floor bridge with bent knees, hips raised to shoulder-knee line and three-breath hold. Begin with five repetitions, progress to thirty. Different from unspecified brief pause.'],
 ['ace-phase1','https://www.acefitness.org/resources/everyone/blog/6594/ace-s-kick-start-workout-a-week-by-week-3-month-exercise-program/','2023-01-06','Introductory week one: one set eight to fifteen glute bridges; ten-second side-plank holds each side, thirty seconds between exercises. Linked technique variants need separate matching; compound or incline variants cannot inherit doses.'],
 ['ace-performance','https://www.acefitness.org/continuing-education/certified/february-2021/7780/how-to-design-body-weight-training-workouts-using-the-ace-integrated-fitness-training-model/',null,'ACE distinguishes explosive squat/split-squat jumps in performance circuits from lower-level training; performance programming is not an automatic LOW general-adult eligibility grant.'],
];
const findings=[
 ['0658',['nhs-strength','mayo-pushup'],'MISSING_EVIDENCE','Shoulder-height wall technique supported by Mayo, which supplies no dose; NHS dose uses chest-height description.','same-variant dose linkage'],
 ['0659',['nhs-strength','mayo-pushup'],'MISSING_EVIDENCE','Mayo supports shoulder-height hands; catalog additionally steps back a few feet after starting at arm length.','distance clarification; same-variant dose'],
 ['0662',['ace-pushup'],'MISSING_EVIDENCE','Floor technique broadly matches, but ACE marks intermediate with no numeric prescription.','dose; LOW scope mapping'],
 ['1373',['nhs-strength'],'MISSING_EVIDENCE','Supported bilateral floor calf raise substantially matches NHS five repetitions. Wall/stable support to chair equivalence needs an independently verified mapping.','independent variant mapping; runtime grant'],
 ['1490',['nhs-strength'],'MISSING_EVIDENCE','Heels off stair edge differ from cited flat-floor calf raise.','stair variant evidence'],
 ['3013',['mayo-bridge','ace-phase1'],'MISSING_EVIDENCE','Bridge general movement matches, but Mayo uses three breaths and catalog brief pause. ACE dose needs linked technique/context verification.','technique-dose linkage; scope mapping'],
 ['3470',['mayo-lunge'],'MISSING_EVIDENCE','Forward lunge aligns with source; repetition count remains capability-dependent.','bounded dose'],
 ['3211',['mayo-pushup'],'CONFLICTING_EVIDENCE','Kneeling title contradicts step two: balls of feet, body head-to-heels. Mayo modified pushup keeps knee support.','name/step contradiction'],
 ['0493',['ace-pushup','mayo-pushup'],'MISSING_EVIDENCE','Bench/step incline differs from floor and wall variants.','support height; exact variant dose'],
 ['0259',['ace-pushup'],'MISSING_EVIDENCE','Close grip changes spacing; elbow alternative does not establish close-grip prescription.','close-grip variant; dose'],
 ['0283',['ace-pushup'],'MISSING_EVIDENCE','Diamond geometry not established by standard setup.','diamond variant; dose'],
 ['0514',['mayo-squat','ace-performance'],'PROFESSIONAL_REVIEW_REQUIRED','Explosive repeated jumps outside current LOW product scope; this is scope escalation, not universal danger.','performance readiness assessment'],
 ['1759',['mayo-squat'],'MISSING_EVIDENCE','Single-leg pistol differs from bilateral squat balance/load.','pistol variant; dose'],
 ['2368',['mayo-lunge'],'MISSING_EVIDENCE','Source includes stationary lunges; starting distance/return sequence need matching and no numeric dose is supplied.','static split-squat mapping; dose'],
 ['1460',['mayo-lunge'],'MISSING_EVIDENCE','Traveling lunge mentioned, but repetitions depend on capacity.','bounded dose'],
 ['1688',['mayo-lunge'],'MISSING_EVIDENCE','Added torso rotation/elbow-to-knee not covered by source.','rotating variant; dose'],
 ['0705',['ace-phase1'],'MISSING_EVIDENCE','Straight-leg forearm side bridge needs exact match to linked beginner/intermediate variant.','linked variant verification'],
 ['0664',['ace-pushup','ace-phase1'],'MISSING_EVIDENCE','Compound pushup-to-side-plank cannot inherit separate prescriptions.','compound sequence evidence'],
 ['3132',['nhs-strength','mayo-squat'],'MISSING_EVIDENCE','Supported potty squat depth unspecified; NHS mini-squat has comfortable partial depth.','range clarification'],
 ['3544',['ace-phase1'],'CONFLICTING_EVIDENCE','Title incline side plank, but instructions place forearm on ground and specify no raised surface.','incline/title-step mismatch'],
];
const pack={version:1,scope:'Pilot primary-page comparison, not exhaustive web research or medical clearance.',sources:sources.map(([id,url,date,summary])=>({id,url,publishedOrReviewedAt:date,accessedAt:'2026-09-20',summary,summaryHash:digest(summary)})),reviews:findings.map(([id,sourceIds,decision,reason,missing])=>{
 const r=rows.find(r=>r.upstream_id===id);if(!r)throw Error('MISSING_CATALOG_ITEM');
 return {sourceId:r.source_id,revision:r.revision,upstreamId:id,itemHash:r.item_hash,inputHash:digest(r),decision,sourceIds,reason,missing:missing.split('; '),reviewer:'codex-primary',independentReview:null};
})};
writeFileSync('scripts/fitness-audit/pilot-evidence.json',JSON.stringify(pack,null,2)+'\n');
writeFileSync('data/fitness-audit/pilot-catalog.json',JSON.stringify(findings.map(([id])=>rows.find(r=>r.upstream_id===id)),null,2)+'\n');
console.log('Prepared 20 exact item-version assessments. No production writes.');
