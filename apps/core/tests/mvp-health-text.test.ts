import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';

it('uses configured owner credentials only after explicit meal parsing, persists candidates and blocks absent approval or bad output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ev-mvp-health-'));
  let decryptions = 0;
  let invalidOutput = false;
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(_url));
    if (url.hostname === 'api.nal.usda.gov') {
      expect(url.searchParams.get('api_key')).toBe('synthetic-usda-key');
      if (url.pathname === '/fdc/v1/foods/search') return new Response(JSON.stringify({ foods: [{ fdcId: 100, dataType: 'SR Legacy', description: 'Synthetic cooked rice' }] }));
      expect(url.pathname).toBe('/fdc/v1/food/100');
      return new Response(JSON.stringify({ fdcId: 100, dataType: 'SR Legacy', description: 'Synthetic cooked rice', foodNutrients: [
        { amount: 100, nutrient: { number: '208', unitName: 'KCAL' } },
        { amount: 10, nutrient: { number: '203', unitName: 'G' } },
        { amount: 20, nutrient: { number: '205', unitName: 'G' } },
        { amount: 5, nutrient: { number: '204', unitName: 'G' } },
      ] }));
    }
    expect(String(_url)).toBe('https://api.deepseek.com/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-provider-key');
    const request = JSON.parse(String(init?.body));
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.messages[1].content).toContain('米饭200克');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(invalidOutput
      ? { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', candidates: [{ displayName: '米饭', quantityDecimal: '200', unit: 'GRAM', calories: 999 }] }
      : { schemaVersion: 'MEAL_CANDIDATE_PARSE_V1', candidates: [{ displayName: '米饭', quantityDecimal: '200', unit: 'GRAM' }] }) } }] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const app = await buildApp({ databasePath: join(directory, 'app.sqlite'), logger: false,
    secretStore: { async protect(value) { return value === 'synthetic-usda-key' ? 'synthetic-protected-usda' : 'synthetic-protected'; }, async unprotect(value) { decryptions++; return value === 'synthetic-protected-usda' ? 'synthetic-usda-key' : 'synthetic-provider-key'; } } });
  try {
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: { username: 'meal-mvp-owner', password: 'synthetic-long-password' } });
    expect(setup.statusCode).toBe(201);
    const cookie = [setup.headers['set-cookie']].flat().join(';').match(/ev_session=([^;]+)/)?.[1];
    expect(cookie).toBeTruthy();
    const cookies = { ev_session: cookie! };
    const payload = { mode: 'PARSE_TEXT', localDate: '2026-09-20', mealText: '米饭200克', disclosureVersion: 'HEALTH_DISCLOSURE_V1' };
    const create = (key: string, body: unknown = payload) => app.inject({ method: 'POST', url: '/v1/nutrition/meal-drafts', cookies, headers: { 'idempotency-key': key }, payload: body as Record<string, unknown> });
    expect((await create('mvp-meal-unconfigured')).statusCode).toBe(503);
    const saved = await app.inject({ method: 'PUT', url: '/v1/providers/deepseek/credential', cookies, payload: { apiKey: 'synthetic-provider-key' } });
    expect(saved.statusCode).toBe(200);
    const capabilities = await app.inject({ method: 'GET', url: '/v1/health-capabilities', cookies });
    expect(capabilities.json().data.find((item: { capability: string }) => item.capability === 'MEAL_CANDIDATE_PARSE').availability).toBe('READY');
    expect(decryptions).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect((await create('mvp-meal-no-consent', { ...payload, disclosureVersion: undefined })).statusCode).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    const parsed = await create('mvp-meal-parse-once');
    expect(parsed.statusCode).toBe(201);
    expect(parsed.json().data.draft.state).toBe('CANDIDATES_READY');
    expect(parsed.json().data.revision.candidates[0]).toMatchObject({ displayName: '米饭', quantityDecimal: '200', unit: 'GRAM' });
    expect((await create('mvp-meal-parse-once')).json().data.draft.id).toBe(parsed.json().data.draft.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decryptions).toBe(1);
    invalidOutput = true;
    expect((await create('mvp-meal-invalid-output')).statusCode).toBe(503);
    const list = await app.inject({ method: 'GET', url: '/v1/nutrition/meal-drafts', cookies });
    expect(list.json().data.items).toHaveLength(1);
    expect((await app.inject({ method: 'PUT', url: '/v1/providers/usda/credential', cookies, payload: { apiKey: 'synthetic-usda-key' } })).statusCode).toBe(200);
    const dataCapabilities = await app.inject({ method: 'GET', url: '/v1/health-capabilities', cookies });
    expect(dataCapabilities.json().data[2]).toMatchObject({ availability: 'READY', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' });
    const draftId = parsed.json().data.draft.id;
    const command = (suffix: string, body: Record<string, unknown>) => app.inject({ method: 'POST', url: `/v1/nutrition/meal-drafts/${draftId}/${suffix}`, cookies, headers: { 'idempotency-key': `mvp-meal-${suffix}` }, payload: body });
    const matched = await command('matches', { expectedVersion: parsed.json().data.draft.version, revisionId: parsed.json().data.revision.id });
    expect(matched.statusCode).toBe(202);
    const match = matched.json().data;
    expect(match.matches[0].snapshots[0].source.sourceKind).toBe('REMOTE_API');
    const selected = await command('revisions', { expectedVersion: match.draft.version, parentRevisionId: match.revision.id, operation: 'SELECT_MATCHES', candidates: [{ candidateId: match.revision.candidates[0].candidateId, included: true, selectedFoodSnapshotId: match.matches[0].snapshots[0].id }] });
    expect(selected.statusCode).toBe(201);
    const confirmed = await command('confirm', { expectedVersion: selected.json().data.draft.version, revisionId: selected.json().data.revision.id });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().data.meal.totals).toEqual({ energyKcalDecimal: '200', proteinGramsDecimal: '20', carbohydrateGramsDecimal: '40', fatGramsDecimal: '10' });
  } finally {
    await app.close();
    vi.unstubAllGlobals();
    if (dirname(resolve(directory)) === resolve(tmpdir())) await rm(directory, { recursive: true, force: true });
  }
});
