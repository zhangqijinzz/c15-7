import type { EnergyDevice, EnergyDocument, EnergyScenario } from '../types';

const STORAGE_KEY = 'energy-lens.document.v1';

export type RepairWarningCode = 'activeScenarioMissing' | 'documentRepaired';

export interface DocumentRepairWarning {
  code: RepairWarningCode;
  message: string;
}

export interface DocumentRepairResult {
  ok: true;
  document: EnergyDocument;
  warnings: DocumentRepairWarning[];
  repaired: boolean;
}

export interface DocumentReadFailure {
  ok: false;
  reason: 'unparseable' | 'unrecoverable';
  message: string;
}

export type StoredDocumentResult = DocumentRepairResult | DocumentReadFailure;

export function readDocument(): EnergyDocument | null {
  const result = readStoredDocument();
  return result?.ok ? result.document : null;
}

export function readStoredDocument(): StoredDocumentResult | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unparseable', message: '本地数据无法解析，已恢复为示例方案。' };
  }

  return repairDocument(parsed)
    ?? { ok: false, reason: 'unrecoverable', message: '本地数据中没有可恢复的方案，已恢复为示例方案。' };
}

export function writeDocument(document: EnergyDocument): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

export function repairDocument(value: unknown): DocumentRepairResult | null {
  const source = unwrapDocument(value);
  if (!source) return null;

  const rawScenarios = getScenarioList(source);
  if (!rawScenarios) return null;

  const usedScenarioIds = new Set<string>();
  const warnings: DocumentRepairWarning[] = [];
  let repaired = source.legacy || source.versionMismatch;

  const scenarios = rawScenarios
    .map((scenario, index) => repairScenario(scenario, index, usedScenarioIds, () => { repaired = true; }))
    .filter((scenario): scenario is EnergyScenario => scenario !== null);

  if (scenarios.length === 0) return null;
  if (scenarios.length !== rawScenarios.length) repaired = true;

  const requestedActiveId = getString(source.record, ['activeScenarioId', 'activeId', 'selectedScenarioId', 'currentScenarioId']);
  const activeScenario = requestedActiveId ? scenarios.find((scenario) => scenario.id === requestedActiveId) : undefined;

  if (!activeScenario) {
    const fallback = scenarios[0];
    warnings.push({
      code: 'activeScenarioMissing',
      message: `原选中的方案已不存在，已切换到“${fallback.name}”，其他方案均已保留。`,
    });
  }

  if (repaired) {
    warnings.push({
      code: 'documentRepaired',
      message: `本地数据来自旧版本或存在字段异常，已自动修复并保留 ${scenarios.length} 个方案。`,
    });
  }

  return {
    ok: true,
    document: {
      version: 1,
      scenarios,
      activeScenarioId: activeScenario?.id ?? scenarios[0].id,
    },
    warnings,
    repaired,
  };
}

interface DocumentSource {
  record: Record<string, unknown>;
  legacy: boolean;
  versionMismatch: boolean;
}

function unwrapDocument(value: unknown): DocumentSource | null {
  if (Array.isArray(value)) {
    return { record: { scenarios: value }, legacy: true, versionMismatch: true };
  }
  if (!isRecord(value)) return null;

  const nested = value.document;
  const record = isRecord(nested) ? nested : value;
  const legacy = nested !== undefined && isRecord(nested);

  return {
    record,
    legacy,
    versionMismatch: record.version !== 1,
  };
}

function getScenarioList(source: DocumentSource): unknown[] | null {
  const record = source.record;
  if (Array.isArray(record.scenarios)) return record.scenarios;
  for (const key of ['plans', 'schemes']) {
    if (Array.isArray(record[key])) {
      source.legacy = true;
      source.versionMismatch = true;
      return record[key] as unknown[];
    }
  }
  return null;
}

function repairScenario(
  value: unknown,
  scenarioIndex: number,
  usedScenarioIds: Set<string>,
  markRepaired: () => void,
): EnergyScenario | null {
  if (!isRecord(value)) return null;

  const id = uniqueId(
    getString(value, ['id']),
    usedScenarioIds,
    `scenario-repaired-${scenarioIndex + 1}`,
    () => markRepaired(),
  );
  const name = nonEmptyString(getString(value, ['name', 'title']), '未命名方案', markRepaired);
  const createdAt = dateString(value, ['createdAt', 'createdAtIso', 'created'], markRepaired);
  const pricePerKwh = boundedNumber(value, ['pricePerKwh', 'pricePerKWh', 'electricityPrice', 'price'], 0, Number.MAX_SAFE_INTEGER, 0, markRepaired);
  const daysPerMonth = boundedNumber(value, ['daysPerMonth', 'monthlyDays', 'days'], 1, 31, 30, markRepaired);
  const devices = repairDevices(value, scenarioIndex, markRepaired);

  return { id, name, pricePerKwh, daysPerMonth, createdAt, devices };
}

function repairDevices(scenario: Record<string, unknown>, scenarioIndex: number, markRepaired: () => void): EnergyDevice[] {
  const rawDevices = getField(scenario, ['devices', 'items']);
  if (!Array.isArray(rawDevices)) {
    markRepaired();
    return [placeholderDevice(scenarioIndex, 1)];
  }

  const usedDeviceIds = new Set<string>();
  const devices = rawDevices
    .map((device, deviceIndex) => repairDevice(device, scenarioIndex, deviceIndex, usedDeviceIds, markRepaired))
    .filter((device): device is EnergyDevice => device !== null);

  if (devices.length !== rawDevices.length || devices.length === 0) markRepaired();
  return devices.length > 0 ? devices : [placeholderDevice(scenarioIndex, 1)];
}

function repairDevice(
  value: unknown,
  scenarioIndex: number,
  deviceIndex: number,
  usedIds: Set<string>,
  markRepaired: () => void,
): EnergyDevice | null {
  if (!isRecord(value)) return null;

  const id = uniqueId(
    getString(value, ['id']),
    usedIds,
    `device-repaired-${scenarioIndex + 1}-${deviceIndex + 1}`,
    markRepaired,
  );
  const name = nonEmptyString(getString(value, ['name', 'deviceName', 'label']), '未命名设备', markRepaired);
  const watts = boundedNumber(value, ['watts', 'power', 'powerWatts'], 0, Number.MAX_SAFE_INTEGER, 0, markRepaired);
  const dailyHours = boundedNumber(value, ['dailyHours', 'hoursPerDay', 'dailyUsageHours', 'usageHours', 'hours'], 0, 24, 0, markRepaired);

  return { id, name, watts, dailyHours };
}

function placeholderDevice(scenarioIndex: number, deviceIndex: number): EnergyDevice {
  return {
    id: `device-repaired-${scenarioIndex + 1}-${deviceIndex}`,
    name: '未命名设备',
    watts: 0,
    dailyHours: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function getString(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = getField(record, keys);
  return typeof value === 'string' ? value : undefined;
}

function nonEmptyString(value: string | undefined, fallback: string, markRepaired: () => void): string {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  markRepaired();
  return fallback;
}

function uniqueId(value: string | undefined, used: Set<string>, fallback: string, markRepaired: () => void): string {
  const base = value?.trim() || fallback;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix++}`;
  }
  if (id !== value?.trim()) markRepaired();
  used.add(id);
  return id;
}

function dateString(record: Record<string, unknown>, keys: string[], markRepaired: () => void): string {
  const value = getString(record, keys)?.trim();
  if (value) return value;
  markRepaired();
  return new Date().toISOString();
}

function boundedNumber(
  record: Record<string, unknown>,
  keys: string[],
  min: number,
  max: number,
  fallback: number,
  markRepaired: () => void,
): number {
  const raw = getField(record, keys);
  const value = typeof raw === 'string' ? raw.trim() : raw;
  const number = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;

  if (!Number.isFinite(number) || number < min || number > max) {
    markRepaired();
    return fallback;
  }
  return number;
}
