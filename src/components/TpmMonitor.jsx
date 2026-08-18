import { useEffect, useMemo, useState } from 'react';

const REFRESH_MS = 10_000;

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function levelFor(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'healthy';
}

function timeLabel(value) {
  if (!value) return '--';
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString('zh-CN', { hour12: false });
}

export default function TpmMonitor() {
  const [models, setModels] = useState([]);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('usage');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  async function refresh({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/model-tpm', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'TPM 数据加载失败。');
      const nextModels = Array.isArray(payload.models) ? payload.models : [];
      setModels(nextModels);
      setUpdatedAt(nextModels[0]?.measuredAt || new Date().toISOString());
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'TPM 数据加载失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh({ quiet: true }), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const rankedModels = useMemo(
    () => [...models].sort((left, right) => {
      if (sortMode === 'water') {
        return right.waterPercent - left.waterPercent
          || right.usedTpm - left.usedTpm
          || left.model.localeCompare(right.model);
      }
      return right.usedTpm - left.usedTpm
        || right.waterPercent - left.waterPercent
        || left.model.localeCompare(right.model);
    }),
    [models, sortMode],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rankedModels;
    return rankedModels.filter((item) => `${item.model} ${item.serviceName} ${item.serviceId}`.toLowerCase().includes(keyword));
  }, [rankedModels, query]);

  const busyCount = models.filter((item) => item.waterPercent >= 70).length;
  const peak = models.reduce((current, item) => !current || item.waterPercent > current.waterPercent ? item : current, null);

  return (
    <section className="monitor-page" aria-labelledby="tpm-title">
      <div className="monitor-heading-row">
        <div>
          <h1 id="tpm-title">模型服务 TPM 总水位</h1>
          <p>汇总每个模型服务下全部 Key、全部 PIN 最近 60 秒的 Token 使用量。</p>
        </div>
        <div className="live-status" aria-label="自动刷新状态">
          <span className="live-dot" />
          10 秒自动刷新 · {timeLabel(updatedAt)}
        </div>
      </div>

      <div className="monitor-summary">
        <div className="summary-item"><span>模型服务</span><strong>{models.length}</strong></div>
        <div className="summary-item"><span>高水位（≥70%）</span><strong className={busyCount ? 'warning-text' : ''}>{busyCount}</strong></div>
        <div className="summary-item"><span>当前最高水位</span><strong>{peak ? `${peak.waterPercent.toFixed(2)}%` : '--'}</strong><small>{peak?.model || '暂无数据'}</small></div>
      </div>

      <div className="monitor-toolbar">
        <div className="sort-field">
          <span className="toolbar-label">排序方式</span>
          <div className="sort-switch" role="group" aria-label="模型排序方式">
            <button type="button" className={sortMode === 'usage' ? 'active' : ''} aria-pressed={sortMode === 'usage'} onClick={() => setSortMode('usage')}>总用量</button>
            <button type="button" className={sortMode === 'water' ? 'active' : ''} aria-pressed={sortMode === 'water'} onClick={() => setSortMode('water')}>水位风险</button>
          </div>
        </div>
        <label className="visually-hidden" htmlFor="model-filter">筛选模型</label>
        <input id="model-filter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入模型名或 service-id" />
        <button className="refresh-button" type="button" onClick={() => refresh()} disabled={loading}>{loading ? '刷新中…' : '立即刷新'}</button>
      </div>

      {error ? <div className="feedback"><strong>监控数据加载失败</strong><span>{error}</span></div> : null}

      <div className="model-table" aria-busy={loading}>
        <div className="model-table-head">
          <span>模型服务（{sortMode === 'water' ? '按水位风险排序' : '按 TPM 用量排序'}）</span><span>当前 TPM / 总配额</span><span>水位</span><span>近 60 秒请求</span>
        </div>
        {filtered.map((item) => {
          const level = levelFor(item.waterPercent);
          return (
            <article className="model-row" key={item.serviceId}>
              <div className="model-identity"><strong>{item.model}</strong><span>{item.serviceId}</span></div>
              <div className="tpm-value"><strong>{formatNumber(item.usedTpm)}</strong><span> / {formatNumber(item.totalTpm)} TPM</span></div>
              <div className="water-cell">
                <div className="water-meta"><strong className={`${level}-text`}>{item.waterPercent.toFixed(2)}%</strong><span>{level === 'critical' ? '接近上限' : level === 'warning' ? '水位偏高' : '运行正常'}</span></div>
                <div className="water-track"><span className={level} style={{ width: `${Math.min(item.waterPercent, 100)}%` }} /></div>
              </div>
              <div className="request-count">{item.requestCount.toLocaleString('zh-CN')}</div>
            </article>
          );
        })}
        {!loading && filtered.length === 0 ? <div className="empty-state">没有匹配的模型服务。</div> : null}
      </div>

      <p className="monitor-note">水位 = 最近 60 秒输入 Token + 输出 Token ÷ model_service.tpm。推理 Token 已包含在输出 Token 中，不重复计算。</p>
    </section>
  );
}
