import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise';
import { Buildings } from '@phosphor-icons/react/dist/icons/Buildings';
import { Cube } from '@phosphor-icons/react/dist/icons/Cube';
import { Stack } from '@phosphor-icons/react/dist/icons/Stack';
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle';
import { X } from '@phosphor-icons/react/dist/icons/X';
import ResourceIcon from './ResourceIcon.jsx';

const PAGE_SIZE = 15;

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function exactNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function percentOf(value, total) {
  const denominator = Number(total || 0);
  if (denominator <= 0) return null;
  return (Number(value || 0) / denominator) * 100;
}

function formatPercent(value) {
  return value === null ? '--' : `${value.toFixed(2)}%`;
}

function riskLevel(value) {
  if (value === null) return 'neutral';
  if (value >= 100) return 'critical';
  if (value >= 70) return 'warning';
  return 'healthy';
}

function capacityRiskLevel(value) {
  if (value === null) return 'neutral';
  if (value > 100) return 'critical';
  if (value >= 85) return 'warning';
  return 'healthy';
}

function modelRisk(model) {
  return percentOf(model.platformTpm, model.totalTpm);
}

function SummaryMetric({ icon: Icon, label, value, detail, tone = '' }) {
  return (
    <div className={`upstream-summary-item ${tone}`}>
      <div className="upstream-summary-icon" aria-hidden="true"><Icon size={21} weight="duotone" /></div>
      <div>
        <span>{label}</span>
        <strong>{exactNumber(value)}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function DrawerMetric({ label, value, detail, level = '' }) {
  return (
    <div className={`upstream-drawer-metric ${level}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function BreakdownTable({ rows, firstColumn }) {
  return (
    <div className="upstream-breakdown-wrap">
      <table className="upstream-breakdown-table">
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th>Endpoint</th>
            <th>TPM</th>
            <th>RPM</th>
            <th>RPS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.serviceId || row.supplier}>
              <td>
                <div className="upstream-breakdown-identity">
                  <ResourceIcon type={row.model ? 'model' : 'supplier'} name={row.model || row.supplier} size="small" />
                  <div>
                    <strong>{row.model || row.supplier}</strong>
                    {row.serviceId ? <span>{row.serviceId}</span> : null}
                  </div>
                </div>
              </td>
              <td>{exactNumber(row.endpointCount)}</td>
              <td title={exactNumber(row.totalTpm)}>{formatNumber(row.totalTpm)}</td>
              <td title={exactNumber(row.totalRpm)}>{formatNumber(row.totalRpm)}</td>
              <td title={exactNumber(row.totalRps)}>{formatNumber(row.totalRps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function QuotaExplorer() {
  const [catalog, setCatalog] = useState({ models: [], suppliers: [], measuredAt: '' });
  const [mode, setMode] = useState('model');
  const [query, setQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [sortBy, setSortBy] = useState('tpm');
  const [selectedKey, setSelectedKey] = useState('');
  const [drawerTab, setDrawerTab] = useState('overview');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  async function loadCatalog() {
    setLoading(true);
    try {
      const [quotaResponse, usageResponse] = await Promise.all([
        fetch('/api/quotas', { cache: 'no-store' }),
        fetch('/api/model-tpm', { cache: 'no-store' }),
      ]);
      const [quotaPayload, usagePayload] = await Promise.all([
        quotaResponse.json().catch(() => ({})),
        usageResponse.json().catch(() => ({})),
      ]);
      if (!quotaResponse.ok) throw new Error(quotaPayload.message || '上游供给数据加载失败。');
      if (!usageResponse.ok) throw new Error(usagePayload.message || '实际用量加载失败。');

      const usageByServiceId = new Map(
        (Array.isArray(usagePayload.models) ? usagePayload.models : [])
          .map((item) => [item.serviceId, item]),
      );
      const models = (Array.isArray(quotaPayload.models) ? quotaPayload.models : [])
        .map((model) => {
          const usage = usageByServiceId.get(model.serviceId);
          return {
            ...model,
            usedTpm: Number(usage?.usedTpm || 0),
            requestCount: Number(usage?.requestCount || 0),
            usageMeasuredAt: usage?.measuredAt || '',
          };
        });
      setCatalog({
        models,
        suppliers: Array.isArray(quotaPayload.suppliers) ? quotaPayload.suppliers : [],
        measuredAt: models[0]?.usageMeasuredAt || quotaPayload.measuredAt || '',
      });
      setError('');
    } catch (requestError) {
      setError(requestError.message || '上游供给数据加载失败。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  const summary = useMemo(() => {
    let endpointCount = 0;
    let riskCount = 0;
    for (const model of catalog.models) {
      endpointCount += Number(model.endpointCount || 0);
      if ((modelRisk(model) || 0) > 100) riskCount += 1;
    }
    return {
      supplierCount: catalog.suppliers.length,
      modelCount: catalog.models.length,
      endpointCount,
      riskCount,
    };
  }, [catalog.models, catalog.suppliers.length]);

  const filtered = useMemo(() => {
    const source = mode === 'model' ? catalog.models : catalog.suppliers;
    const next = source.filter((item) => {
      const searchable = mode === 'model'
        ? `${item.model} ${item.serviceName} ${item.serviceId}`
        : item.supplier;
      if (deferredQuery && !searchable.toLowerCase().includes(deferredQuery)) return false;
      if (mode === 'model' && supplierFilter !== 'all' && !item.suppliers.some((entry) => entry.supplier === supplierFilter)) return false;
      if (mode === 'model' && riskFilter !== 'all') {
        const level = capacityRiskLevel(modelRisk(item));
        if (riskFilter === 'risk' && level !== 'critical') return false;
        if (riskFilter === 'watch' && level !== 'warning') return false;
        if (riskFilter === 'healthy' && level !== 'healthy') return false;
      }
      return true;
    });

    return next.toSorted((left, right) => {
      if (sortBy === 'name') {
        return (mode === 'model' ? left.model : left.supplier)
          .localeCompare(mode === 'model' ? right.model : right.supplier);
      }
      if (sortBy === 'risk' && mode === 'model') {
        return (modelRisk(right) || 0) - (modelRisk(left) || 0);
      }
      return Number(right.totalTpm || 0) - Number(left.totalTpm || 0);
    });
  }, [catalog.models, catalog.suppliers, deferredQuery, mode, riskFilter, sortBy, supplierFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = filtered.find((item) => (
    mode === 'model' ? item.serviceId === selectedKey : item.supplier === selectedKey
  )) || filtered[0] || null;

  const selectedCapacity = useMemo(() => {
    if (mode !== 'model' || !selected) return null;
    const platformTpm = Number(selected.platformTpm || 0);
    const supplierTpm = Number(selected.totalTpm || 0);
    const usedTpm = Number(selected.usedTpm || 0);
    return {
      platformTpm,
      supplierTpm,
      usedTpm,
      effectiveTpm: platformTpm > 0 && supplierTpm > 0 ? Math.min(platformTpm, supplierTpm) : 0,
      userWater: percentOf(usedTpm, platformTpm),
      upstreamWater: percentOf(usedTpm, supplierTpm),
      oversubscription: percentOf(platformTpm, supplierTpm),
    };
  }, [mode, selected]);

  function changeMode(nextMode) {
    setMode(nextMode);
    setQuery('');
    setSupplierFilter('all');
    setRiskFilter('all');
    setSortBy('tpm');
    setSelectedKey('');
    setDrawerTab('overview');
    setDrawerOpen(true);
    setPage(1);
  }

  function selectItem(key) {
    setSelectedKey(key);
    setDrawerTab('overview');
    setDrawerOpen(true);
  }

  function resetFilters() {
    setQuery('');
    setSupplierFilter('all');
    setRiskFilter('all');
    setSortBy('tpm');
    setPage(1);
  }

  const selectedRows = mode === 'model' ? selected?.suppliers || [] : selected?.models || [];
  const drawerTabs = mode === 'model'
    ? [['overview', '概览'], ['suppliers', '供应商构成'], ['endpoints', 'Endpoint 明细']]
    : [['overview', '概览'], ['suppliers', '模型构成'], ['endpoints', 'Endpoint 汇总']];

  return (
    <section className="quota-page upstream-page" aria-labelledby="quota-title">
      <div className="quota-heading-row upstream-heading-row">
        <div>
          <h1 id="quota-title">上游供给</h1>
          <p>从供应商到模型再到 Endpoint，查看供给能力、平台限额与容量风险。</p>
        </div>
        <button className="quota-reload" type="button" onClick={loadCatalog} disabled={loading}>
          <ArrowsClockwise size={16} aria-hidden="true" />
          {loading ? '加载中…' : '刷新数据'}
        </button>
      </div>

      <div className="upstream-summary" aria-label="上游供给概览">
        <SummaryMetric icon={Buildings} label="供应商" value={summary.supplierCount} detail="当前有效供给方" />
        <SummaryMetric icon={Cube} label="模型" value={summary.modelCount} detail="已接入模型服务" />
        <SummaryMetric icon={Stack} label="Endpoint" value={summary.endpointCount} detail="有效配置总数" />
        <SummaryMetric icon={WarningCircle} label="容量风险模型" value={summary.riskCount} detail="平台限额高于上游容量" tone={summary.riskCount > 0 ? 'danger' : ''} />
      </div>

      <div className="upstream-controls">
        <div className="quota-mode" role="group" aria-label="上游供给视角">
          <button type="button" className={mode === 'model' ? 'active' : ''} aria-pressed={mode === 'model'} onClick={() => changeMode('model')}>模型视角</button>
          <button type="button" className={mode === 'supplier' ? 'active' : ''} aria-pressed={mode === 'supplier'} onClick={() => changeMode('supplier')}>供应商视角</button>
        </div>
        <label className="visually-hidden" htmlFor="quota-search">搜索上游供给</label>
        <input
          id="quota-search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          placeholder={mode === 'model' ? '搜索模型名称或 service-id' : '搜索供应商名称'}
        />
        {mode === 'model' ? <>
          <label className="visually-hidden" htmlFor="quota-supplier-filter">供应商筛选</label>
          <select id="quota-supplier-filter" value={supplierFilter} onChange={(event) => { setSupplierFilter(event.target.value); setPage(1); }}>
            <option value="all">全部供应商</option>
            {catalog.suppliers.map((supplier) => <option key={supplier.supplier} value={supplier.supplier}>{supplier.supplier}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="quota-risk-filter">容量风险筛选</label>
          <select id="quota-risk-filter" value={riskFilter} onChange={(event) => { setRiskFilter(event.target.value); setPage(1); }}>
            <option value="all">全部风险</option>
            <option value="risk">超配风险</option>
            <option value="watch">需要关注</option>
            <option value="healthy">容量健康</option>
          </select>
        </> : null}
        <label className="visually-hidden" htmlFor="quota-sort">排序方式</label>
        <select id="quota-sort" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="tpm">按 TPM 排序</option>
          {mode === 'model' ? <option value="risk">按风险排序</option> : null}
          <option value="name">按名称排序</option>
        </select>
        <button className="upstream-reset" type="button" onClick={resetFilters}>重置</button>
      </div>

      {error ? <div className="feedback quota-feedback"><strong>上游供给数据加载失败</strong><span>{error}</span></div> : null}

      <div className={`upstream-workspace ${drawerOpen && selected ? 'drawer-visible' : ''}`} aria-busy={loading}>
        <div className="upstream-table-panel">
          <div className="upstream-table-meta">
            <strong>{mode === 'model' ? '模型供给列表' : '供应商供给列表'}</strong>
            <span>共 {filtered.length} 条结果</span>
          </div>
          <div className="upstream-table-scroll">
            <table className="upstream-table">
              <thead>
                {mode === 'model' ? <tr>
                  <th>模型名称</th><th>供应商</th><th>Endpoint</th><th>上游 TPM</th><th>上游 RPM</th><th>平台限额</th><th>容量风险</th><th>状态</th><th aria-label="操作" />
                </tr> : <tr>
                  <th>供应商</th><th>模型</th><th>Endpoint</th><th>TPM</th><th>RPM</th><th>RPS</th><th>状态</th><th aria-label="操作" />
                </tr>}
              </thead>
              <tbody>
                {visibleRows.map((item) => {
                  const key = mode === 'model' ? item.serviceId : item.supplier;
                  const active = selected && key === (mode === 'model' ? selected.serviceId : selected.supplier);
                  const risk = mode === 'model' ? modelRisk(item) : null;
                  const level = capacityRiskLevel(risk);
                  return mode === 'model' ? (
                    <tr key={key} className={active && drawerOpen ? 'selected' : ''}>
                      <td><button className="upstream-name-button" type="button" onClick={() => selectItem(key)}><ResourceIcon type="model" name={item.model} /><span className="upstream-name-copy"><strong>{item.model}</strong><span>{item.serviceId}</span></span></button></td>
                      <td title={item.suppliers.map((supplier) => supplier.supplier).join('、')}><span className="upstream-supplier-cell"><ResourceIcon type="supplier" name={item.suppliers[0]?.supplier} size="small" /><span>{item.supplierCount === 1 ? item.suppliers[0]?.supplier : `${exactNumber(item.supplierCount)} 家`}</span></span></td>
                      <td>{exactNumber(item.endpointCount)}</td>
                      <td title={exactNumber(item.totalTpm)}>{formatNumber(item.totalTpm)}</td>
                      <td title={exactNumber(item.totalRpm)}>{formatNumber(item.totalRpm)}</td>
                      <td title={exactNumber(item.platformTpm)}>{formatNumber(item.platformTpm)}</td>
                      <td><span className={`risk-text ${level}`}>{formatPercent(risk)}</span></td>
                      <td><span className={`status-label ${level}`}>{level === 'critical' ? '存在风险' : level === 'warning' ? '需要关注' : level === 'healthy' ? '正常' : '待核验'}</span></td>
                      <td><button className="upstream-view-button" type="button" onClick={() => selectItem(key)}>查看</button></td>
                    </tr>
                  ) : (
                    <tr key={key} className={active && drawerOpen ? 'selected' : ''}>
                      <td><button className="upstream-name-button" type="button" onClick={() => selectItem(key)}><ResourceIcon type="supplier" name={item.supplier} /><span className="upstream-name-copy"><strong>{item.supplier}</strong><span>{item.modelCount} 个模型</span></span></button></td>
                      <td>{exactNumber(item.modelCount)}</td>
                      <td>{exactNumber(item.endpointCount)}</td>
                      <td title={exactNumber(item.totalTpm)}>{formatNumber(item.totalTpm)}</td>
                      <td title={exactNumber(item.totalRpm)}>{formatNumber(item.totalRpm)}</td>
                      <td title={exactNumber(item.totalRps)}>{formatNumber(item.totalRps)}</td>
                      <td><span className="status-label healthy">正常</span></td>
                      <td><button className="upstream-view-button" type="button" onClick={() => selectItem(key)}>查看</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && visibleRows.length === 0 ? <div className="upstream-empty">没有符合条件的上游供给数据。</div> : null}
          </div>
          <div className="upstream-pagination">
            <span>第 {currentPage} / {pageCount} 页</span>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button>
          </div>
        </div>

        {drawerOpen && selected ? <aside className="upstream-drawer" aria-label={`${mode === 'model' ? selected.model : selected.supplier} 详情`}>
          <div className="upstream-drawer-heading">
            <div className="upstream-drawer-identity">
              <ResourceIcon type={mode === 'model' ? 'model' : 'supplier'} name={mode === 'model' ? selected.model : selected.supplier} size="large" />
              <div>
                <h2>{mode === 'model' ? selected.model : selected.supplier}</h2>
                <p>{mode === 'model' ? `${selected.serviceId} · ${selected.supplierCount} 个供应商 · ${selected.endpointCount} 个 Endpoint` : `${selected.modelCount} 个模型 · ${selected.endpointCount} 个 Endpoint`}</p>
              </div>
            </div>
            <button type="button" aria-label="关闭详情" onClick={() => setDrawerOpen(false)}><X size={17} aria-hidden="true" /></button>
          </div>
          <div className="upstream-drawer-tabs" role="tablist" aria-label="详情视图">
            {drawerTabs.map(([key, label]) => <button key={key} role="tab" type="button" aria-selected={drawerTab === key} className={drawerTab === key ? 'active' : ''} onClick={() => setDrawerTab(key)}>{label}</button>)}
          </div>

          {drawerTab === 'overview' ? <div className="upstream-drawer-content">
            <div className="upstream-drawer-metrics">
              <DrawerMetric label="上游 TPM" value={formatNumber(selected.totalTpm)} detail="Endpoint 配置容量" />
              <DrawerMetric label="上游 RPM" value={formatNumber(selected.totalRpm)} detail="请求 / 分钟" />
              <DrawerMetric label="RPS" value={formatNumber(selected.totalRps)} detail="请求 / 秒" />
              <DrawerMetric label="Endpoint" value={exactNumber(selected.endpointCount)} detail="有效配置数量" />
            </div>
            {mode === 'model' ? <>
              <div className="upstream-safe-capacity">
                <span>安全参考总配额</span>
                <strong>{formatNumber(selectedCapacity.effectiveTpm)} TPM</strong>
                <small>MIN（平台对外 TPM，上游配置 TPM）</small>
              </div>
              <div className="upstream-drawer-metrics risk-metrics">
                <DrawerMetric label="平台对外配额" value={formatNumber(selectedCapacity.platformTpm)} detail={`${formatNumber(selected.platformRpm)} RPM`} />
                <DrawerMetric label="近 60 秒实际用量" value={formatNumber(selectedCapacity.usedTpm)} detail={`${exactNumber(selected.requestCount)} 次请求`} />
                <DrawerMetric label="用户水位" value={formatPercent(selectedCapacity.userWater)} detail="实际用量 ÷ 平台限额" level={riskLevel(selectedCapacity.userWater)} />
                <DrawerMetric label="容量风险" value={formatPercent(selectedCapacity.oversubscription)} detail="平台限额 ÷ 上游容量" level={capacityRiskLevel(selectedCapacity.oversubscription)} />
              </div>
            </> : null}
          </div> : null}

          {drawerTab === 'suppliers' ? <div className="upstream-drawer-content">
            <div className="upstream-section-heading"><h3>{mode === 'model' ? '供应商构成' : '模型构成'}</h3><span>按 TPM 从高到低</span></div>
            <BreakdownTable rows={selectedRows} firstColumn={mode === 'model' ? '供应商' : '模型'} />
          </div> : null}

          {drawerTab === 'endpoints' ? <div className="upstream-drawer-content">
            <div className="upstream-endpoint-note">当前接口提供供应商/模型维度的 Endpoint 数量与容量聚合；单个 Endpoint ID、区域和健康状态尚未接入。</div>
            <div className="upstream-section-heading"><h3>Endpoint 容量汇总</h3><span>聚合口径</span></div>
            <BreakdownTable rows={selectedRows} firstColumn={mode === 'model' ? '供应商' : '模型'} />
          </div> : null}
        </aside> : null}
      </div>

      <p className="monitor-note">口径说明：上游容量为有效、未下线 Endpoint 配置值之和，尚未按账号、订阅、区域或共享配额池去重；“容量风险”用于比较平台对外限额与当前上游配置容量，不代表合同 Token 余额。</p>
    </section>
  );
}
