function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function textValue(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function buildQuotaCatalog(rows) {
  const modelMap = new Map();
  const supplierMap = new Map();

  for (const row of rows) {
    const serviceId = textValue(row.service_id);
    if (!serviceId) continue;

    const model = modelMap.get(serviceId) || {
      serviceId,
      serviceName: textValue(row.service_name, serviceId),
      model: textValue(row.model, textValue(row.service_name, serviceId)),
      platformTpm: numberValue(row.platform_tpm),
      platformRpm: numberValue(row.platform_rpm),
      totalTpm: 0,
      totalRpm: 0,
      totalRps: 0,
      endpointCount: 0,
      suppliers: [],
    };

    const endpointCount = numberValue(row.endpoint_count);
    const totalTpm = numberValue(row.total_tpm);
    const totalRpm = numberValue(row.total_rpm);
    const totalRps = numberValue(row.total_rps);

    model.totalTpm += totalTpm;
    model.totalRpm += totalRpm;
    model.totalRps += totalRps;
    model.endpointCount += endpointCount;

    if (endpointCount > 0) {
      const supplier = textValue(row.supplier, '未标注供应商').toLowerCase();
      const supplierQuota = {
        supplier,
        endpointCount,
        totalTpm,
        totalRpm,
        totalRps,
      };
      model.suppliers.push(supplierQuota);

      const supplierEntry = supplierMap.get(supplier) || {
        supplier,
        totalTpm: 0,
        totalRpm: 0,
        totalRps: 0,
        endpointCount: 0,
        models: [],
      };
      supplierEntry.totalTpm += totalTpm;
      supplierEntry.totalRpm += totalRpm;
      supplierEntry.totalRps += totalRps;
      supplierEntry.endpointCount += endpointCount;
      supplierEntry.models.push({
        serviceId,
        serviceName: model.serviceName,
        model: model.model,
        endpointCount,
        totalTpm,
        totalRpm,
        totalRps,
      });
      supplierMap.set(supplier, supplierEntry);
    }

    modelMap.set(serviceId, model);
  }

  const models = [...modelMap.values()].map((model) => ({
    ...model,
    supplierCount: model.suppliers.length,
    suppliers: model.suppliers.sort((left, right) => right.totalTpm - left.totalTpm),
  })).sort((left, right) => right.totalTpm - left.totalTpm || left.model.localeCompare(right.model));

  const suppliers = [...supplierMap.values()].map((supplier) => ({
    ...supplier,
    modelCount: supplier.models.length,
    models: supplier.models.sort((left, right) => right.totalTpm - left.totalTpm),
  })).sort((left, right) => right.totalTpm - left.totalTpm || left.supplier.localeCompare(right.supplier));

  return {
    measuredAt: new Date().toISOString(),
    models,
    suppliers,
  };
}

