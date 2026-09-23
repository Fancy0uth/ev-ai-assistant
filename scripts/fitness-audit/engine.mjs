import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const POLICY = 'PUBLIC_EVIDENCE_AUDIT_V1';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const statuses = new Set(['PUBLIC_EVIDENCE_COMPLETE', 'MISSING_EVIDENCE', 'CONFLICTING_EVIDENCE', 'PROFESSIONAL_REVIEW_REQUIRED']);
const hosts = new Set(['www.nhs.uk', 'www.mayoclinic.org', 'www.acefitness.org', 'www.heart.org']);
const nonblank = s => typeof s === 'string' && s.trim().length > 0;
const texts = a => Array.isArray(a) && a.length > 0 && a.every(nonblank);
const positive = n => Number.isInteger(n) && n > 0;

function validateEvidence(evidence) {
  if (!Number.isInteger(evidence.version) || evidence.version < 1) throw Error('EVIDENCE_VERSION');
  if (new Set(evidence.sources.map(s => s.id)).size !== evidence.sources.length) throw Error('DUPLICATE_SOURCE');
  for (const s of evidence.sources) {
    const url = new URL(s.url);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password) throw Error('SOURCE_NOT_ALLOWED');
    if (!s.summary || digest(s.summary) !== s.summaryHash) throw Error('SOURCE_HASH');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt)) throw Error('SOURCE_DATE');
  }
  const keys = evidence.reviews.map(r => [r.sourceId,r.revision,r.upstreamId,r.itemHash,r.inputHash].join(':'));
  if (new Set(keys).size !== keys.length) throw Error('DUPLICATE_REVIEW');
}

export function auditOne(item, evidence) {
  validateEvidence(evidence);
  const base = { policy: POLICY, sourceId: item.source_id, revision: item.revision,
    upstreamId: item.upstream_id, itemHash: item.item_hash, name: item.name,
    inputHash: digest(item), evidenceHash: digest(evidence), medicalReview: false,
    recommendationEnabled: false };
  const r = evidence.reviews.find(r => r.sourceId === item.source_id && r.revision === item.revision
    && r.upstreamId === item.upstream_id && r.itemHash === item.item_hash && r.inputHash === digest(item));
  if (!r) return { ...base, status: 'PENDING_RESEARCH', reason: 'No exact item-version assessment in the current evidence pack. Not a completed source search.' };
  if (!statuses.has(r.decision) || !r.reason?.trim() || !Array.isArray(r.missing) || !r.sourceIds?.length) throw Error('REVIEW_INVALID');
  if (r.sourceIds.some(id => !evidence.sources.some(s => s.id === id))) throw Error('SOURCE_MISSING');
  if (r.decision === 'PUBLIC_EVIDENCE_COMPLETE') {
    // This is an evidence result, never a professional credential or a production grant.
    if (r.missing.length || r.independentReview?.confirmed !== true || !nonblank(r.independentReview.reviewer)
      || !nonblank(r.reviewer) || r.independentReview.reviewer === r.reviewer
      || !nonblank(r.exactVariant) || !nonblank(r.scope?.population) || !texts(r.scope?.equipment)
      || !positive(r.parameters?.sets) || !positive(r.parameters?.minimum) || !positive(r.parameters?.maximum)
      || r.parameters.maximum < r.parameters.minimum || !['REPETITIONS','SECONDS'].includes(r.parameters?.unit)
      || !texts(r.limitations) || !Array.isArray(r.claims) || !r.claims.length
      || r.claims.some(c => !r.sourceIds.includes(c.sourceId) || !nonblank(c.statement) || !nonblank(c.locator))) throw Error('INCOMPLETE_APPROVAL');
  }
  return { ...base, status: r.decision, reason: r.reason, missing: r.missing,
    sources: evidence.sources.filter(s => r.sourceIds.includes(s.id)), assessment: r };
}

export function runBatch(items, evidence, output, batchSize = 20) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw Error('BATCH_SIZE');
  validateEvidence(evidence);
  if (new Set(items.map(i => i.source_id + ':' + i.revision + ':' + i.upstream_id)).size !== items.length) throw Error('DUPLICATE_ITEM');
  mkdirSync(output, { recursive: true });
  const file = join(output, 'results.json');
  const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const next = [];
  let processed = 0;
  for (const item of items) {
    const old = prior.find(r => r.sourceId === item.source_id && r.revision === item.revision && r.upstreamId === item.upstream_id);
    if (old?.inputHash === digest(item) && old.evidenceHash === digest(evidence) && old.policy === POLICY) { next.push(old); continue; }
    if (processed >= batchSize) continue;
    next.push({ ...auditOne(item, evidence), assessedAt: new Date().toISOString() }); processed++;
  }
  // Save only records belonging to this catalog snapshot; obsolete results cannot remain enabled.
  writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n'); renameSync(file + '.tmp', file);
  const counts = next.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  const summary = { policy: POLICY, total: items.length, screened: next.length,
    researched: next.filter(r => r.status !== 'PENDING_RESEARCH').length,
    remainingToScreen: items.length - next.length, processed, counts,
    modelCalls: 0, networkCalls: 0, productionWrites: 0 };
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
