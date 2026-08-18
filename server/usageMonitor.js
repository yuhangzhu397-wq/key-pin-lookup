const DEFAULT_DAYS = 14;
const DEFAULT_THRESHOLDS = {
  warningBelowPercent: 10,
  criticalBelowPercent: 5,
  capacityWarningPercent: 80,
  capacityCriticalPercent: 100,
};

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function niceCeiling(value) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / magnitude) * magnitude;
}

export function monitoringDays() {
  const configured = Number(process.env.USAGE_MONITOR_DAYS || DEFAULT_DAYS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 30 ? configured : DEFAULT_DAYS;
}

function configuredPercent(name, fallback, minimum, maximum) {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured >= minimum && configured <= maximum
    ? configured
    : fallback;
}

export function monitoringPolicy(days = monitoringDays()) {
  const warningBelowPercent = configuredPercent(
    'USAGE_WARNING_BELOW_PERCENT',
    DEFAULT_THRESHOLDS.warningBelowPercent,
    1,
    50,
  );
  const criticalBelowPercent = configuredPercent(
    'USAGE_CRITICAL_BELOW_PERCENT',
    DEFAULT_THRESHOLDS.criticalBelowPercent,
    0,
    warningBelowPercent,
  );
  const capacityWarningPercent = configuredPercent(
    'USAGE_CAPACITY_WARNING_PERCENT',
    DEFAULT_THRESHOLDS.capacityWarningPercent,
    50,
    100,
  );
  const capacityCriticalPercent = configuredPercent(
    'USAGE_CAPACITY_CRITICAL_PERCENT',
    DEFAULT_THRESHOLDS.capacityCriticalPercent,
    capacityWarningPercent,
    200,
  );

  return {
    observationDays: days,
    warningBelowPercent,
    criticalBelowPercent,
    capacityWarningPercent,
    capacityCriticalPercent,
    basis: `${days} 天内分钟峰值 TPM/RPM 的较高利用率`,
    readOnly: true,
  };
}

export function evaluateUsageRow(row, scope, days = DEFAULT_DAYS, policy = monitoringPolicy(days)) {
  const limitTpm = number(row.limit_tpm);
  const limitRpm = number(row.limit_rpm);
  const peakTpm = number(row.peak_tpm);
  const peakRpm = number(row.peak_rpm);
  const tpmUtilization = limitTpm > 0 ? peakTpm / limitTpm * 100 : null;
  const rpmUtilization = limitRpm > 0 ? peakRpm / limitRpm * 100 : null;
  const comparable = [tpmUtilization, rpmUtilization].filter((value) => value !== null);
  const utilization = comparable.length ? Math.max(...comparable) : null;
  const requestCount = number(row.request_count);
  const keyType = scope === 'key' ? String(row.key_type || '') : null;
  const keyKind = scope === 'key' ? (keyType === 'autoBind' ? 'member' : 'pin-owned') : null;

  let level = 'unconfigured';
  if (utilization !== null) {
    if (utilization >= policy.capacityCriticalPercent) level = 'exceeded';
    else if (utilization >= policy.capacityWarningPercent) level = 'capacity';
    else if (requestCount === 0 || utilization < policy.criticalBelowPercent) level = 'critical';
    else if (utilization < policy.warningBelowPercent) level = 'warning';
    else level = 'healthy';
  }

  const recommend = level === 'critical' || level === 'warning';
  const hasUsageEvidence = requestCount > 0;
  const recommendedTpm = recommend && hasUsageEvidence && limitTpm > 0
    ? Math.min(limitTpm, niceCeiling(Math.max(peakTpm * 2, 100)))
    : null;
  const recommendedRpm = recommend && hasUsageEvidence && limitRpm > 0
    ? Math.min(limitRpm, niceCeiling(Math.max(peakRpm * 2, 10)))
    : null;
  const confidence = requestCount === 0
    ? 'needs-age-check'
    : number(row.active_days) < Math.min(3, days) ? 'limited-history' : 'supported';

  return {
    scope,
    userId: String(row.user_id || ''),
    keyId: scope === 'key' ? String(row.api_key_id || '') : null,
    keyType,
    keyKind,
    memberId: scope === 'key' ? String(row.erp || '') : null,
    serviceId: String(row.service_id || ''),
    model: String(row.model || row.service_name || row.service_id || ''),
    limitTpm,
    limitRpm,
    peakTpm,
    peakRpm,
    tpmUtilization,
    rpmUtilization,
    utilization,
    requestCount,
    activeDays: number(row.active_days),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    recommendedTpm,
    recommendedRpm,
    confidence,
    level,
    observationDays: days,
  };
}

export function buildUsageMonitor(keyRows, pinRows, days = DEFAULT_DAYS, diagnostics = {}) {
  const policy = monitoringPolicy(days);
  const keys = keyRows.map((row) => evaluateUsageRow(row, 'key', days, policy));
  const pins = pinRows.map((row) => evaluateUsageRow(row, 'pin', days, policy));
  return {
    policy,
    keys,
    pins,
    diagnostics,
    measuredAt: new Date().toISOString(),
  };
}
