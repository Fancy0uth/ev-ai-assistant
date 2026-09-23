'use client';

import { nutritionCredentialResponseSchema, type NutritionCredentialMetadata } from '@ev/contracts';
import { useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

export function NutritionProviderSettings() {
  const [metadata, setMetadata] = useState<NutritionCredentialMetadata | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usdaOpen, setUsdaOpen] = useState(false);
  const metadataRead = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const metadataGeneration = useRef(0);

  function abortMetadataRead(): void {
    const activeRead: AbortController | null = metadataRead.current;
    if (activeRead !== null) activeRead.abort();
    metadataRead.current = null;
  }

  useEffect(() => {
    if (!usdaOpen) return;
    const controller = new AbortController();
    abortMetadataRead();
    metadataRead.current = controller;
    const generation = metadataGeneration.current;
    setMessage('正在读取 USDA 专用来源配置…');
    void requestCore('providers/usda/credential', { method: 'GET', signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted && metadataRead.current === controller && metadataGeneration.current === generation) {
          setMetadata(nutritionCredentialResponseSchema.parse(payload).data);
          setMessage('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && metadataRead.current === controller && metadataGeneration.current === generation) setMessage('营养数据配置暂时不可用');
      });
    return () => {
      controller.abort();
      if (metadataRead.current === controller) metadataRead.current = null;
    };
  }, [usdaOpen]);
  useEffect(() => () => {
    abortMetadataRead();
    mutation.current?.abort();
  }, []);

  async function update(remove: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    abortMetadataRead();
    metadataGeneration.current += 1;
    mutation.current?.abort();
    mutation.current = controller;
    const body = remove ? { confirm: true } : { apiKey };
    setApiKey('');
    try {
      const payload = await requestCore('providers/usda/credential', {
        method: remove ? 'DELETE' : 'PUT', body: JSON.stringify(body), signal: controller.signal,
      });
      if (!controller.signal.aborted && mutation.current === controller) {
        abortMetadataRead();
        metadataGeneration.current += 1;
        setMetadata(nutritionCredentialResponseSchema.parse(payload).data);
        setMessage(remove ? '营养数据密钥已移除' : '密钥已保存；尚未发起数据查询');
        setConfirmDelete(false);
      }
    } catch (error) {
      if (!controller.signal.aborted && mutation.current === controller) setMessage(error instanceof CoreClientError ? error.message : '操作未完成，请重试');
    } finally {
      if (!controller.signal.aborted && mutation.current === controller) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }

  return <section className="provider-credential-card" aria-labelledby="nutrition-provider-heading">
    <header className="provider-credential-card__header"><div>
      <h2 id="nutrition-provider-heading">营养匹配</h2>
      <p>使用本页的 DeepSeek API 配置，在本地缓存未命中时从 Wikipedia 公开资料检索营养候选。</p>
    </div></header>
    <p>本地缓存优先：相同食物名称和单位的缓存命中不会调用 DeepSeek 或网络；缓存未命中才发起公开资料查询。</p>
    <p>来源记录缓存只供后续匹配复用，不等同于已确认餐食；只有你确认后才写入餐食记录。</p>
    <p>Wikipedia 是首个公开来源，覆盖有限，不能覆盖所有食物。无有效来源时会保持未匹配；请在确认前核对食物、生熟状态和单位。</p>
    <p>候选匹配仅发送食物名称和单位，不发送餐食原文、个人资料或身份信息；查到的来源记录会保留在本地缓存中。</p>
    <details onToggle={(event) => setUsdaOpen(event.currentTarget.open)}>
      <summary>可选：USDA 专用来源</summary>
      {usdaOpen ? <div>
        <h3>USDA FoodData Central</h3>
        <p>这是可选的专用来源。名称及份量需要核对，中文食物不保证能匹配。</p>
        <p>状态：{metadata ? metadata.state === 'CONFIGURED' ? '已配置（查询时验证）' : '未配置' : '读取中'}</p>
        <p><a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noreferrer">申请 FoodData Central API key</a>；不接受公共 DEMO_KEY。</p>
        <form className="provider-credential-form" onSubmit={(event) => { event.preventDefault(); void update(false); }}>
          <label htmlFor="usda-api-key">USDA API key</label>
          <input id="usda-api-key" type="password" autoComplete="new-password" maxLength={256} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={busy} />
          <div className="provider-credential-actions">
            <button type="submit" disabled={busy || !apiKey.trim()}>保存营养数据密钥</button>
            <button type="button" disabled={busy || metadata?.state !== 'CONFIGURED'} onClick={() => setConfirmDelete(true)}>移除营养数据密钥</button>
          </div>
        </form>
        {confirmDelete ? <div><p>移除后需要重新填写密钥才能查询此专用来源。</p><button type="button" disabled={busy} onClick={() => void update(true)}>确认移除</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button></div> : null}
        <p role="status">{message}</p>
      </div> : null}
    </details>
  </section>;
}
