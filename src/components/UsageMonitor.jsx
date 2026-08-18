import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  DownloadSimple,
  Funnel,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';

const PAGE_SIZE = 12;
const LEVEL_ORDER = { exceeded: 0, capacity: 1, critical: 2, warning: 3, healthy: 4, unconfigured: 5 };
const LOW_LEVELS = new Set(['critical', 'warning']);
const CAPACITY_LEVELS = new Set(['exceeded', 'capacity']);

function formatNumber(value) {
  const number = Number(value) || 0;
  const absolute = Math.abs(number);
  const units = [
    [1e16, '京'],
    [1e12, '万亿'],
    [1e8, '亿'],
    [1e4, '万'],
  ];
  const matched = units.find(([threshold]) => absolute >= threshold);
  if (!matched) return new Intl.NumberFormat('zh-CN').format(number);
  const [threshold, suffix] = matched;
  return `${(number / threshold).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}${suffix}`;
}

function formatQuota(value) {
  return Number(value) >= 9e18 ? '不限额' : formatNumber(value);
}

function formatQuotaPair(tpm, rpm) {
  return `${formatQuota(tpm)} / ${formatQuota(rpm)}`;
}

function formatTime(value) {
  if (!value) return '观察期内无调用';
  const date = new Date(value.replace?.(' ', 'T') || value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function formatMeasuredAt(value) {
  if (!value) return '尚未完成分析';
  return formatTime(value);
}

function utilizationLabel(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(2)}%`;
}

function levelLabel(level) {
  if (level === 'exceeded') return '已超配置';
  if (level === 'capacity') return '临近上限';
  if (level === 'critical') return '高优先级';
  if (level === 'warning') return '需关注';
  if (level === 'healthy') return '正常';
  return '未配置';
}

function aggregateKeyRows(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = row.keyId || `${row.userId}-${row.serviceId}`;
    const current = grouped.get(key) || {
      keyId: row.keyId,
      userId: row.userId,
      memberId: row.memberId,
      rows: [],
      limitTpm: 0,
      limitRpm: 0,
      peakTpm: 0,
      peakRpm: 0,
      recommendedTpm: 0,
      recommendedRpm: 0,
      requestCount: 0,
      activeDays: 0,
      lastUsedAt: null,
      utilization: null,
      level: 'unconfigured',
      confidence: 'supported',
    };

    current.rows.push(row);
    current.limitTpm += row.limitTpm || 0;
    current.limitRpm += row.limitRpm || 0;
    current.peakTpm += row.peakTpm || 0;
    current.peakRpm += row.peakRpm || 0;
    current.recommendedTpm += row.recommendedTpm ?? row.limitTpm ?? 0;
    current.recommendedRpm += row.recommendedRpm ?? row.limitRpm ?? 0;
    current.requestCount += row.requestCount || 0;
    current.activeDays = Math.max(current.activeDays, row.activeDays || 0);

    if (row.lastUsedAt && (!current.lastUsedAt || row.lastUsedAt > current.lastUsedAt)) {
      current.lastUsedAt = row.lastUsedAt;
    }

    grouped.set(key, current);
  });

  return [...grouped.values()].map((item) => {
    const riskRow = item.rows.reduce((selected, row) => {
      if (!selected) return row;
      const selectedOrder = LEVEL_ORDER[selected.level] ?? Number.POSITIVE_INFINITY;
      const rowOrder = LEVEL_ORDER[row.level] ?? Number.POSITIVE_INFINITY;
      if (rowOrder !== selectedOrder) return rowOrder < selectedOrder ? row : selected;
      return (row.utilization ?? -1) > (selected.utilization ?? -1) ? row : selected;
    }, null);
    if (riskRow) {
      item.level = riskRow.level;
      item.utilization = riskRow.utilization;
      item.confidence = riskRow.confidence;
    }
    return item;
  });
}

function buildPinGroups(rows) {
  const rowsByPin = new Map();
  rows.forEach((row) => {
    const pinRows = rowsByPin.get(row.userId) || [];
    pinRows.push(row);
    rowsByPin.set(row.userId, pinRows);
  });

  return [...rowsByPin.entries()]
    .map(([userId, pinRows]) => {
      const keys = aggregateKeyRows(pinRows);
      return {
        userId,
        keyCount: keys.length,
        alertCount: keys.filter((key) => LOW_LEVELS.has(key.level) || CAPACITY_LEVELS.has(key.level)).length,
        lowCount: keys.filter((key) => LOW_LEVELS.has(key.level)).length,
        capacityCount: keys.filter((key) => CAPACITY_LEVELS.has(key.level)).length,
        criticalCount: keys.filter((key) => key.level === 'critical').length,
        warningCount: keys.filter((key) => key.level === 'warning').length,
        limitTpm: keys.reduce((sum, key) => sum + key.limitTpm, 0),
        reclaimableTpm: keys.reduce((sum, key) => sum + Math.max(0, key.limitTpm - key.recommendedTpm), 0),
      };
    })
    .sort((left, right) => right.alertCount - left.alertCount || right.keyCount - left.keyCount || left.userId.localeCompare(right.userId));
}

function downloadSuggestions(rows) {
  if (!rows.length) return;
  const header = ['Key ID', 'PIN', '负责人', '模型', '状态', '证据可信度', '当前 TPM', '当前 RPM', '14天峰值 TPM', '14天峰值 RPM', '建议 TPM', '建议 RPM'];
  const body = rows.flatMap((key) => key.rows.map((row) => [
    key.keyId,
    key.userId,
    key.memberId || '',
    row.model,
    levelLabel(row.level),
    row.confidence,
    row.limitTpm,
    row.limitRpm,
    row.peakTpm,
    row.peakRpm,
    row.recommendedTpm ?? '',
    row.recommendedRpm ?? '',
  ]));
  const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `下游配额建议-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function UsageMonitor() {
  const [payload, setPayload] = useState({ keys: [], pins: [], policy: {} });
  const [risk, setRisk] = useState('alert');
  const [pinRisk, setPinRisk] = useState('all');
  const [pinQuery, setPinQuery] = useState('');
  const [keyQuery, setKeyQuery] = useState('');
  const [selectedPin, setSelectedPin] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [page, setPage] = useState(1);
  const [reviewed, setReviewed] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const detailCloseRef = useRef(null);
  const detailTriggerRef = useRef(null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/usage-monitor${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || '用量数据加载失败。');
      setPayload(data);
      setError('');
      setNotice(data.warning || '');
    } catch (requestError) {
      setError(requestError.message || '用量数据加载失败。');
      setNotice('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!payload.refreshing) return undefined;
    const timer = window.setTimeout(() => { void refresh(); }, 10_000);
    return () => window.clearTimeout(timer);
  }, [payload.cacheSavedAt, payload.refreshing, refresh]);

  const allKeyRows = payload.keys || [];
  const pinGroups = useMemo(() => buildPinGroups(allKeyRows), [allKeyRows]);
  const visiblePins = useMemo(() => {
    const keyword = pinQuery.trim().toLowerCase();
    return pinGroups
      .filter((pin) => !keyword || pin.userId.toLowerCase().includes(keyword))
      .filter((pin) => {
        if (pinRisk === 'alert') return pin.lowCount > 0;
        if (pinRisk === 'capacity') return pin.capacityCount > 0;
        if (pinRisk === 'critical') return pin.criticalCount > 0;
        if (pinRisk === 'warning') return pin.warningCount > 0;
        return true;
      });
  }, [pinGroups, pinQuery, pinRisk]);

  useEffect(() => {
    if (!selectedPin || !visiblePins.some((pin) => pin.userId === selectedPin)) {
      setSelectedPin(visiblePins[0]?.userId || '');
      setSelectedKeyId('');
    }
  }, [selectedPin, visiblePins]);

  useEffect(() => {
    if (!selectedKeyId) return undefined;
    detailCloseRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeDetails();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedKeyId]);

  const selectedPinGroup = pinGroups.find((pin) => pin.userId === selectedPin);
  const pinRows = useMemo(
    () => allKeyRows.filter((row) => row.userId === selectedPin),
    [allKeyRows, selectedPin],
  );
  const groupedKeys = useMemo(() => aggregateKeyRows(pinRows), [pinRows]);
  const filteredKeys = useMemo(() => {
    const keyword = keyQuery.trim().toLowerCase();
    return groupedKeys
      .filter((item) => risk === 'all'
        || (risk === 'alert' ? LOW_LEVELS.has(item.level) : false)
        || (risk === 'capacity-risk' ? CAPACITY_LEVELS.has(item.level) : false)
        || item.level === risk)
      .filter((item) => !keyword || `${item.keyId} ${item.memberId} ${item.rows.map((row) => `${row.model} ${row.serviceId}`).join(' ')}`.toLowerCase().includes(keyword))
      .sort((left, right) => LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level]
        || (left.utilization ?? Number.POSITIVE_INFINITY) - (right.utilization ?? Number.POSITIVE_INFINITY)
        || left.keyId.localeCompare(right.keyId));
  }, [groupedKeys, keyQuery, risk]);

  const pageCount = Math.max(1, Math.ceil(filteredKeys.length / PAGE_SIZE));
  const visibleKeys = filteredKeys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedKey = groupedKeys.find((item) => item.keyId === selectedKeyId);
  const keyAlerts = groupedKeys.filter((item) => LOW_LEVELS.has(item.level)).length;
  const capacityRisks = groupedKeys.filter((item) => CAPACITY_LEVELS.has(item.level)).length;
  const uncertainKeys = groupedKeys.filter((item) => item.confidence !== 'supported' && LOW_LEVELS.has(item.level)).length;
  const estimatedReclaimable = groupedKeys.reduce((sum, item) => sum + Math.max(0, item.limitTpm - item.recommendedTpm), 0);
  const pinLimits = (payload.pins || []).filter((item) => item.userId === selectedPin);
  const pinLimitTpm = pinLimits.reduce((sum, item) => sum + (item.limitTpm || 0), 0);
  const pinLimitRpm = pinLimits.reduce((sum, item) => sum + (item.limitRpm || 0), 0);

  function selectPin(pin) {
    setSelectedPin(pin);
    setSelectedKeyId('');
    setPage(1);
  }

  function openDetails(keyId, trigger) {
    detailTriggerRef.current = trigger;
    setSelectedKeyId(keyId);
  }

  function closeDetails() {
    setSelectedKeyId('');
    requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }

  function markReviewed(keyId) {
    setReviewed((current) => {
      const next = new Set(current);
      next.add(keyId);
      return next;
    });
  }

  return (
    <section className="downstream-page" aria-labelledby="usage-title">
      <div className="downstream-titlebar">
        <div>
          <div className="downstream-titleline">
            <h1 id="usage-title">下游配额治理</h1>
            <span>{payload.policy?.observationDays || 14} 天观察期</span>
          </div>
          <p>沿 PIN → Key → 模型定位长期低利用率配额；仅生成运营建议，不自动调整限额。</p>
        </div>
        <button className="downstream-refresh" type="button" onClick={() => refresh(true)} disabled={loading || payload.refreshing}>
          <ArrowClockwise size={17} weight="bold" />{loading ? '加载中…' : payload.refreshing ? '后台分析中…' : '重新分析'}
        </button>
      </div>

      {error ? <div className="feedback usage-error"><strong>用量监控加载失败</strong><span>{error}</span></div> : null}
      {notice ? <div className="feedback usage-notice"><strong>{payload.refreshing ? '后台正在更新数据' : '当前展示缓存数据'}</strong><span>{notice}</span></div> : null}
      {payload.diagnostics?.complete === false ? <div className="feedback usage-error"><strong>数据覆盖不完整，禁止据此直接降额</strong><span>查询达到 {payload.diagnostics.maxRows?.toLocaleString('zh-CN')} 行上限；请提高 USAGE_MONITOR_MAX_ROWS 后重新分析。</span></div> : null}

      <div className="usage-assurance" role="status">
        <span><strong>分析时间</strong>{formatMeasuredAt(payload.measuredAt)}</span>
        <span><strong>判断口径</strong>{payload.policy?.basis || '14 天分钟峰值'}</span>
        <span><strong>治理阈值</strong>低于 {payload.policy?.warningBelowPercent ?? 10}% 待降额；高于 {payload.policy?.capacityWarningPercent ?? 80}% 查容量</span>
        <span className={uncertainKeys ? 'has-warning' : ''}><strong>证据待确认</strong>{uncertainKeys} 个 Key</span>
      </div>

      <div className="downstream-workspace" aria-busy={loading}>
        <aside className="pin-navigator">
          <div className="pin-nav-heading">
            <div><strong>PIN 导航</strong><span>{pinGroups.length} 个 PIN</span></div>
            <label className="pin-risk-filter">
              <Funnel size={15} />
              <select value={pinRisk} onChange={(event) => setPinRisk(event.target.value)} aria-label="PIN 风险筛选">
                <option value="all">全部 PIN</option>
                <option value="alert">有待降额</option>
                <option value="capacity">有容量风险</option>
                <option value="critical">有高优先级</option>
                <option value="warning">有需关注</option>
              </select>
              <CaretDown size={12} weight="bold" />
            </label>
          </div>
          <label className="pin-search">
            <MagnifyingGlass size={17} />
            <input value={pinQuery} onChange={(event) => setPinQuery(event.target.value)} placeholder="搜索 PIN" aria-label="搜索 PIN" />
          </label>
          <div className="pin-risk-legend"><span>按待复核数量排序</span><span><i /> 高优先级</span></div>
          <div className="pin-list">
            {visiblePins.map((pin) => (
              <button key={pin.userId} type="button" className={selectedPin === pin.userId ? 'active' : ''} onClick={() => selectPin(pin.userId)} aria-current={selectedPin === pin.userId ? 'true' : undefined}>
                <span className="pin-selection-marker" aria-hidden="true">{selectedPin === pin.userId ? <CheckCircle size={15} weight="fill" /> : null}</span>
                <span><strong>{pin.userId}</strong><small>{pin.keyCount} 个 Key</small></span>
                <em className={pin.lowCount ? 'has-risk' : pin.capacityCount ? 'has-capacity-risk' : ''}>{pin.lowCount || pin.capacityCount}</em>
              </button>
            ))}
            {!loading && visiblePins.length === 0 ? <div className="pin-empty">没有匹配的 PIN</div> : null}
          </div>
          <div className="pin-nav-foot"><span><i className="critical-dot" />高优先级</span><span><i className="warning-dot" />需关注</span></div>
        </aside>

        <div className="key-workspace">
          <div className="pin-overview">
            <div className="pin-overview-name"><span>当前 PIN</span><strong>{selectedPin || '—'}</strong></div>
            <div><span>PIN 模型额度合计</span><strong>{formatQuotaPair(pinLimitTpm, pinLimitRpm)}</strong><small>跨模型 TPM / RPM</small></div>
            <div><span>全部 Key</span><strong>{groupedKeys.length}</strong></div>
            <div><span>待降额复核</span><strong className={keyAlerts ? 'warning-text' : ''}>{keyAlerts}</strong><small>预计可回收 {formatNumber(estimatedReclaimable)} TPM</small></div>
            <div><span>容量风险</span><strong className={capacityRisks ? 'critical-text' : ''}>{capacityRisks}</strong><small>利用率 ≥ {payload.policy?.capacityWarningPercent ?? 80}%</small></div>
          </div>

          <div id="usage-key-panel">
            <div className="key-toolbar">
              <label><MagnifyingGlass size={17} /><input value={keyQuery} onChange={(event) => { setKeyQuery(event.target.value); setPage(1); }} placeholder="搜索 Key、负责人或模型" aria-label="搜索 Key、负责人或模型" /></label>
              <select value={risk} onChange={(event) => { setRisk(event.target.value); setPage(1); }} aria-label="风险筛选">
                <option value="alert">仅看待复核</option>
                <option value="capacity-risk">仅看容量风险</option>
                <option value="exceeded">已超配置</option>
                <option value="capacity">临近上限</option>
                <option value="all">全部状态</option>
                <option value="critical">高优先级</option>
                <option value="warning">需关注</option>
                <option value="healthy">利用率正常</option>
                <option value="unconfigured">未单独配置</option>
              </select>
              <button type="button" onClick={() => { setRisk('alert'); setKeyQuery(''); setPage(1); }}>重置</button>
              <button type="button" disabled={!filteredKeys.length} onClick={() => downloadSuggestions(filteredKeys)}><DownloadSimple size={15} />导出当前结果</button>
              <span>共 {filteredKeys.length} 条</span>
            </div>

            <div className="key-governance-table">
              <div className="key-table-head"><span>Key / 负责人</span><span>当前额度</span><span>14 天峰值</span><span>利用率</span><span>最近使用</span><span>建议额度</span><span>状态</span></div>
              {visibleKeys.map((item) => (
                <button className={selectedKeyId === item.keyId ? 'key-table-row active' : 'key-table-row'} key={item.keyId} type="button" onClick={(event) => openDetails(item.keyId, event.currentTarget)}>
                  <span className="key-cell-identity"><strong>{item.keyId}</strong><small>{item.memberId ? `负责人：${item.memberId}` : `所属 PIN：${item.userId}`}</small></span>
                  <span><strong>{formatQuotaPair(item.limitTpm, item.limitRpm)}</strong><small>TPM / RPM · {item.rows.length} 个模型</small></span>
                  <span><strong>{formatNumber(item.peakTpm)} / {formatNumber(item.peakRpm)}</strong><small>TPM / RPM</small></span>
                  <span><strong className={`${item.level}-text`}>{utilizationLabel(item.utilization)}</strong><small>{item.confidence === 'supported' ? 'TPM、RPM 较高值' : '需确认 Key 创建时间'}</small></span>
                  <span><strong>{formatTime(item.lastUsedAt)}</strong><small>{item.requestCount.toLocaleString('zh-CN')} 次请求</small></span>
                  <span><strong>{item.confidence === 'needs-age-check' && LOW_LEVELS.has(item.level) ? '待确认' : LOW_LEVELS.has(item.level) ? `${formatNumber(item.recommendedTpm)} / ${formatNumber(item.recommendedRpm)}` : '—'}</strong><small>{item.confidence === 'needs-age-check' ? '先确认已存在满观察期' : LOW_LEVELS.has(item.level) ? 'TPM / RPM' : '无需降额建议'}</small></span>
                  <span className="key-status"><em className={`status-${item.level}`}>{reviewed.has(item.keyId) ? '已复核' : levelLabel(item.level)}</em><CaretRight size={15} /></span>
                </button>
              ))}
              {!loading && visibleKeys.length === 0 ? <div className="empty-state">当前 PIN 下没有符合条件的 Key。</div> : null}
            </div>

            <div className="key-table-footer">
              <span>当前 PIN：{selectedPinGroup?.keyCount || 0} 个 Key · {selectedPinGroup?.lowCount || 0} 个待降额 · {selectedPinGroup?.capacityCount || 0} 个容量风险</span>
              {pageCount > 1 ? <div><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div> : null}
            </div>
          </div>
        </div>

        {selectedKey ? <aside className="key-detail-drawer" aria-label={`${selectedKey.keyId} 配额详情`}>
          <div className="drawer-heading"><div><span>Key 配额详情</span><h2>{selectedKey.keyId}</h2><p>{selectedKey.memberId ? `负责人：${selectedKey.memberId} · ` : ''}PIN：{selectedKey.userId}</p></div><button ref={detailCloseRef} type="button" onClick={closeDetails} aria-label="关闭详情"><X size={20} /></button></div>
          <div className="drawer-summary"><div><span>当前模型额度合计</span><strong>{formatQuota(selectedKey.limitTpm)} TPM</strong><small>{formatQuota(selectedKey.limitRpm)} RPM</small></div><div><span>14 天分钟峰值合计</span><strong>{formatNumber(selectedKey.peakTpm)} TPM</strong><small>{formatNumber(selectedKey.peakRpm)} RPM</small></div><div><span>最需关注模型</span><strong className={`${selectedKey.level}-text`}>{utilizationLabel(selectedKey.utilization)}</strong><small>{levelLabel(selectedKey.level)}</small></div></div>
          <div className="drawer-section"><div className="drawer-section-heading"><h3>模型配额明细</h3><span>{selectedKey.rows.length} 个模型</span></div><div className="drawer-models">{selectedKey.rows.map((row) => <div key={row.serviceId}><span><strong>{row.model}</strong><small>{row.serviceId}</small></span><span><strong>{formatQuotaPair(row.limitTpm, row.limitRpm)}</strong><small>当前 TPM / RPM</small></span><span><strong className={`${row.level}-text`}>{utilizationLabel(row.utilization)}</strong><small>峰值利用率</small></span></div>)}</div></div>
          <div className="drawer-section"><div className="drawer-section-heading"><h3>14 天峰值概览</h3><span>当前数据源无逐日序列</span></div><div className="peak-bars">{selectedKey.rows.slice(0, 5).map((row) => <div key={row.serviceId}><span>{row.model}</span><div><i style={{ width: `${Math.min(100, row.utilization || 0)}%` }} /></div><strong>{utilizationLabel(row.utilization)}</strong></div>)}</div></div>
          <div className="drawer-section drawer-reason"><h3>判断依据与限制</h3><p><CheckCircle size={17} weight="fill" />观察期内按模型计算分钟峰值，TPM、RPM 取较高利用率。</p><p><CheckCircle size={17} weight="fill" />低于 {payload.policy?.warningBelowPercent ?? 10}% 待降额复核；高于 {payload.policy?.capacityWarningPercent ?? 80}% 检查容量风险。</p><p><CheckCircle size={17} weight="fill" />有调用记录时，建议额度约为峰值 2 倍并保留最低保护值。</p>{selectedKey.confidence !== 'supported' ? <p className="drawer-caution">当前证据不足：数据库没有 Key 创建时间，零调用 Key 必须确认已存在满 {payload.policy?.observationDays || 14} 天后才能降额。</p> : null}</div>
          <div className="drawer-actions"><button type="button" onClick={() => downloadSuggestions([selectedKey])}><DownloadSimple size={17} />导出复核单</button><button className="primary" type="button" onClick={() => markReviewed(selectedKey.keyId)}><CheckCircle size={17} />{reviewed.has(selectedKey.keyId) ? '本次会话已复核' : '本次会话标记复核'}</button></div>
        </aside> : null}
      </div>
    </section>
  );
}
