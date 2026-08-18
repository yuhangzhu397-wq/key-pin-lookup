import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuotaCatalog } from './quotaCatalog.js';

test('builds model and supplier quota views from endpoint aggregates', () => {
  const result = buildQuotaCatalog([
    { service_id: 's-1', service_name: 'Model One', model: 'Model-1', platform_tpm: 1000, platform_rpm: 100, supplier: 'JCloud', endpoint_count: 2, total_tpm: 600, total_rpm: 60, total_rps: 6 },
    { service_id: 's-1', service_name: 'Model One', model: 'Model-1', platform_tpm: 1000, platform_rpm: 100, supplier: 'Huoshan', endpoint_count: 1, total_tpm: 400, total_rpm: 40, total_rps: 4 },
    { service_id: 's-2', service_name: 'Model Two', model: 'Model-2', platform_tpm: 500, platform_rpm: 50, supplier: 'JCloud', endpoint_count: 1, total_tpm: 500, total_rpm: 50, total_rps: 5 },
    { service_id: 's-3', service_name: 'No Endpoint', model: 'Model-3', platform_tpm: 300, platform_rpm: 30, supplier: '未标注供应商', endpoint_count: 0, total_tpm: 0, total_rpm: 0, total_rps: 0 },
  ]);

  assert.equal(result.models.length, 3);
  assert.deepEqual(result.models[0], {
    serviceId: 's-1',
    serviceName: 'Model One',
    model: 'Model-1',
    platformTpm: 1000,
    platformRpm: 100,
    totalTpm: 1000,
    totalRpm: 100,
    totalRps: 10,
    endpointCount: 3,
    supplierCount: 2,
    suppliers: [
      { supplier: 'jcloud', endpointCount: 2, totalTpm: 600, totalRpm: 60, totalRps: 6 },
      { supplier: 'huoshan', endpointCount: 1, totalTpm: 400, totalRpm: 40, totalRps: 4 },
    ],
  });
  assert.equal(result.models[2].supplierCount, 0);
  assert.equal(result.suppliers.length, 2);
  assert.equal(result.suppliers[0].supplier, 'jcloud');
  assert.equal(result.suppliers[0].modelCount, 2);
  assert.equal(result.suppliers[0].totalTpm, 1100);
});

