import type { EnergyDevice, EnergyDocument, EnergyScenario } from './types';

/**
 * 修复过程中发生的问题，用于决定是否需要提示用户。
 * - active-realigned:  当前选中的方案指向失效（方案缺失或无法挽救），已收敛到真实存在的方案
 * - scenarios-dropped: 存在完全无法挽救、只能丢弃的方案
 * - legacy-version:    数据来自旧版本（version 字段缺失或不同），已按当前版本迁移
 * - fields-repaired:   同版本内有字段/设备出入，已就地修复（含设备丢弃或参数收敛）
 */
export type RepairIssue = 'active-realigned' | 'scenarios-dropped' | 'legacy-version' | 'fields-repaired';

export interface RepairResult {
  /** 无法挽救（非对象、方案列表缺失或为空）时为 null，交由上层回退示例 */
  document: EnergyDocument | null;
  issues: Set<RepairIssue>;
}

interface RepairedScenario {
  scenario: EnergyScenario | null;
  repaired: boolean;
}

interface RepairedDevice {
  device: EnergyDevice | null;
  repaired: boolean;
}

/**
 * 把宽松读取出来的本地数据尽力修复成合法文档。
 * 原则：指向失效不等于数据损坏；只要还能挽救的方案和设备，一个都不丢。
 */
export function repairDocument(value: unknown): RepairResult {
  const issues = new Set<RepairIssue>();
  if (!isPlainObject(value) || !Array.isArray(value.scenarios)) return { document: null, issues };

  const usedScenarioIds = new Set<string>();
  const scenarios: EnergyScenario[] = [];
  value.scenarios.forEach((entry, index) => {
    const result = repairScenario(entry, index, usedScenarioIds);
    if (!result.scenario) {
      issues.add('scenarios-dropped');
      return;
    }
    if (result.repaired) issues.add('fields-repaired');
    usedScenarioIds.add(result.scenario.id);
    scenarios.push(result.scenario);
  });

  // 一份没有任何方案的数据无法工作，按不可挽救处理，由上层回退示例
  if (scenarios.length === 0) return { document: null, issues };

  let activeScenarioId = typeof value.activeScenarioId === 'string' ? value.activeScenarioId : '';
  if (!scenarios.some((scenario) => scenario.id === activeScenarioId)) {
    // 指针失效本身不是损坏：收敛到第一个真实存在的方案，并明确告知用户
    activeScenarioId = scenarios[0].id;
    issues.add('active-realigned');
  }

  if (value.version !== 1) issues.add('legacy-version');

  return { document: { version: 1, scenarios, activeScenarioId }, issues };
}

function repairScenario(value: unknown, index: number, usedIds: Set<string>): RepairedScenario {
  if (!isPlainObject(value)) return { scenario: null, repaired: false };

  let repaired = false;

  let id: string;
  if (typeof value.id === 'string' && value.id.length > 0 && !usedIds.has(value.id)) {
    id = value.id;
  } else {
    id = `scenario-repaired-${Date.now()}-${index}`;
    repaired = true;
  }

  const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : '未命名方案';
  if (name !== value.name) repaired = true;

  const createdAt = typeof value.createdAt === 'string' && value.createdAt.length > 0
    ? value.createdAt
    : new Date().toISOString();
  if (createdAt !== value.createdAt) repaired = true;

  // 电价没有合理上限，无法使用时回退到常见居民电价
  const price = repairNumber(value.pricePerKwh, 0.62, 0, Infinity);
  if (price.repaired) repaired = true;

  // 计费天数有明确区间，越界时收敛到边界而不是丢弃
  const days = repairNumber(value.daysPerMonth, 30, 1, 31);
  if (days.repaired) repaired = true;

  const devices: EnergyDevice[] = [];
  if (Array.isArray(value.devices)) {
    const usedDeviceIds = new Set<string>();
    for (const entry of value.devices) {
      const result = repairDevice(entry, usedDeviceIds);
      if (!result.device) {
        // 单个设备损坏只丢这一台，方案本身保留
        repaired = true;
        continue;
      }
      if (result.repaired) repaired = true;
      usedDeviceIds.add(result.device.id);
      devices.push(result.device);
    }
  } else {
    // 设备列表字段缺失/改名属于旧版本结构出入：保留方案（空设备），由用户补全
    repaired = true;
  }

  return {
    scenario: { id, name, createdAt, pricePerKwh: price.value, daysPerMonth: days.value, devices },
    repaired,
  };
}

function repairDevice(value: unknown, usedIds: Set<string>): RepairedDevice {
  if (!isPlainObject(value)) return { device: null, repaired: false };

  let repaired = false;

  let id: string;
  if (typeof value.id === 'string' && value.id.length > 0 && !usedIds.has(value.id)) {
    id = value.id;
  } else {
    id = `device-repaired-${Date.now()}-${usedIds.size}`;
    repaired = true;
  }

  const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : '未命名设备';
  if (name !== value.name) repaired = true;

  // 未知功率按 0 处理，不臆造耗电量，用户在界面上一眼可见并补全
  const watts = repairNumber(value.watts, 0, 0, Infinity);
  if (watts.repaired) repaired = true;

  const dailyHours = repairNumber(value.dailyHours, 1, 0, 24);
  if (dailyHours.repaired) repaired = true;

  return { device: { id, name, watts: watts.value, dailyHours: dailyHours.value }, repaired };
}

interface NumberRepair {
  value: number;
  /** 类型转换、回退默认值或越界收敛均算修复 */
  repaired: boolean;
}

/** 旧版本可能把数值存成字符串（如 "0.62"），这类出入宽容转换而不是丢弃 */
function repairNumber(value: unknown, fallback: number, min: number, max: number): NumberRepair {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return { value: fallback, repaired: true };
  if (parsed < min) return { value: min, repaired: true };
  if (parsed > max) return { value: max, repaired: true };
  return { value: parsed, repaired: typeof value !== 'number' };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
