// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exampleScenario } from '../domain';
import { LocalEnergyRepository } from '../repository';
import type { EnergyDocument } from '../types';

const STORAGE_KEY = 'energy-lens.document.v1';

function validScenario(id: string, name = id) {
  return {
    id,
    name,
    pricePerKwh: 0.62,
    daysPerMonth: 30,
    createdAt: '2026-02-03T00:00:00.000Z',
    devices: [{ id: `${id}-d1`, name: '空调', watts: 1200, dailyHours: 6 }],
  };
}

function readStored(): EnergyDocument {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!) as EnergyDocument;
}

describe('local persistence recovery', () => {
  beforeEach(() => localStorage.clear());

  it('keeps every scenario when only the active pointer is dangling, and realigns visibly', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      scenarios: [validScenario('s1', '居家'), validScenario('s2', '露营'), validScenario('s3', '办公')],
      activeScenarioId: 'already-gone',
    }));

    const result = new LocalEnergyRepository().load();

    // 指向失效不等于数据损坏：三个方案一台设备都不能丢
    expect(result.document.scenarios.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(result.document.scenarios.every((s) => s.devices.length === 1)).toBe(true);
    // 当前选中项收敛到真实存在的方案
    expect(result.document.activeScenarioId).toBe('s1');
    // 必须让用户看得见，不能默默切换；这不是错误，不使用 error
    expect(result.notice?.kind).toBe('info');
    expect(result.notice?.text).toContain('已自动切换');
    // 修复结果已回写，下次加载不再重复修复
    expect(readStored().activeScenarioId).toBe('s1');
  });

  it('repairs legacy-shaped documents instead of dropping them', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      // 旧版本：无 version 字段、数值以字符串保存
      activeScenarioId: 'legacy',
      scenarios: [{
        id: 'legacy',
        name: '老方案',
        pricePerKwh: '0.62',
        daysPerMonth: '30',
        createdAt: '2025-01-01T00:00:00.000Z',
        devices: [{ id: 'legacy-d1', name: '空调', watts: '1200', dailyHours: '6' }],
      }],
    }));

    const result = new LocalEnergyRepository().load();

    expect(result.document.scenarios).toHaveLength(1);
    const scenario = result.document.scenarios[0];
    expect(scenario.pricePerKwh).toBe(0.62);
    expect(scenario.daysPerMonth).toBe(30);
    expect(scenario.devices[0]).toMatchObject({ watts: 1200, dailyHours: 6 });
    expect(result.document.activeScenarioId).toBe('legacy');
    expect(result.notice?.kind).toBe('info');
    expect(result.notice?.text).toContain('旧版本');
  });

  it('repairs a single broken device in place without losing its scenario', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      scenarios: [{
        ...validScenario('s1'),
        devices: [
          { id: 'd-good', name: '冰箱', watts: 150, dailyHours: 10 },
          null,
          { id: 'd-bad', name: '电暖器', watts: -999, dailyHours: 30 },
        ],
      }],
      activeScenarioId: 's1',
    }));

    const result = new LocalEnergyRepository().load();
    const scenario = result.document.scenarios[0];
    // 方案保留，坏设备被丢弃、越界设备收敛到边界
    expect(scenario.devices.map((d) => d.id)).toEqual(['d-good', 'd-bad']);
    expect(scenario.devices[1].watts).toBe(0);
    expect(scenario.devices[1].dailyHours).toBe(24);
    expect(result.notice?.text).toContain('参数异常');
  });

  it('drops only the unrecognizable scenarios and keeps every salvageable one', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      scenarios: [null, validScenario('keep-me', '要保留的方案'), 'broken'],
      activeScenarioId: 'missing',
    }));

    const result = new LocalEnergyRepository().load();
    expect(result.document.scenarios.map((s) => s.id)).toEqual(['keep-me']);
    expect(result.document.activeScenarioId).toBe('keep-me');
    // 真的丢了东西时用 error 明确告知，但其余方案都在
    expect(result.notice?.kind).toBe('error');
    expect(result.notice?.text).toContain('无法识别');
  });

  it('falls back to the example only when nothing can be salvaged', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, scenarios: [null], activeScenarioId: 'missing' }));
    const result = new LocalEnergyRepository().load();
    expect(result.document.scenarios).toEqual([exampleScenario]);
    expect(result.document.activeScenarioId).toBe(exampleScenario.id);
    expect(result.notice?.kind).toBe('error');
  });

  it('falls back to the example when JSON is unreadable', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    const result = new LocalEnergyRepository().load();
    expect(result.document.activeScenarioId).toBe(exampleScenario.id);
    expect(result.notice?.text).toContain('无法读取');
  });

  it('starts from the example silently on first use with no stored data', () => {
    const result = new LocalEnergyRepository().load();
    expect(result.document.activeScenarioId).toBe(exampleScenario.id);
    expect(result.notice).toBeNull();
  });
});
