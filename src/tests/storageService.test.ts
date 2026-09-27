// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exampleScenario } from '../domain';
import { LocalEnergyRepository } from '../repository';
import { readStoredDocument, repairDocument } from '../services/storageService';
import type { EnergyDevice, EnergyScenario } from '../types';

const STORAGE_KEY = 'energy-lens.document.v1';

function device(id: string, name = id): EnergyDevice {
  return { id, name, watts: 100, dailyHours: 2 };
}

function scenario(id: string, name = id, devices: EnergyDevice[] = [device(`${id}-device`)]): EnergyScenario {
  return { id, name, pricePerKwh: 0.6, daysPerMonth: 30, createdAt: '2026-01-01T00:00:00.000Z', devices };
}

describe('local persistence recovery', () => {
  beforeEach(() => localStorage.clear());

  it('uses the example and reports a reset when saved JSON cannot be parsed', () => {
    localStorage.setItem(STORAGE_KEY, '{broken-json');
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.document.activeScenarioId).toBe(exampleScenario.id);
    expect(recovered.document.scenarios[0].devices.length).toBeGreaterThan(0);
    expect(recovered.shouldPersist).toBe(true);
    expect(recovered.warnings).toEqual([expect.objectContaining({ kind: 'error', code: 'documentReset' })]);
  });

  it('uses the example when no scenario in the document can be salvaged', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, scenarios: [null], activeScenarioId: 'missing' }));
    const recovered = new LocalEnergyRepository().load();
    expect(recovered.document.activeScenarioId).toBe(exampleScenario.id);
    expect(recovered.document.scenarios[0].devices.length).toBeGreaterThan(0);
    expect(recovered.warnings).toEqual([expect.objectContaining({ kind: 'error', code: 'documentReset' })]);
  });

  it('keeps every scenario when only the active pointer is missing', () => {
    const first = scenario('scenario-a', '方案 A');
    const second = scenario('scenario-b', '方案 B', [device('b-1'), device('b-2')]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      scenarios: [first, second],
      activeScenarioId: 'deleted-scenario',
    }));

    const result = readStoredDocument();
    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error('expected repaired document');

    expect(result.document.scenarios.map((item) => item.id)).toEqual(['scenario-a', 'scenario-b']);
    expect(result.document.scenarios[1].devices).toHaveLength(2);
    expect(result.document.activeScenarioId).toBe('scenario-a');
    expect(result.repaired).toBe(false);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'activeScenarioMissing' })]);
  });

  it('repairs an old data shape instead of discarding its scenarios and devices', () => {
    const result = repairDocument({
      version: 0,
      plans: [{
        id: 'legacy-plan',
        title: '旧版方案',
        electricityPrice: '0.8',
        monthlyDays: '28',
        items: [
          { deviceName: '空调', power: '1200', hours: '6' },
          { deviceName: '冰箱', power: 80, hoursPerDay: 10 },
        ],
      }],
      activeId: 'legacy-plan',
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error('expected legacy document');

    expect(result.document.version).toBe(1);
    expect(result.document.scenarios[0]).toMatchObject({
      id: 'legacy-plan',
      name: '旧版方案',
      pricePerKwh: 0.8,
      daysPerMonth: 28,
    });
    expect(result.document.scenarios[0].devices.map((item) => item.name)).toEqual(['空调', '冰箱']);
    expect(result.document.activeScenarioId).toBe('legacy-plan');
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'documentRepaired' })]);
  });

  it('salvages valid scenarios even when another record is malformed', () => {
    const result = repairDocument({
      version: 1,
      scenarios: [null, scenario('keep-me', '可保留方案')],
      activeScenarioId: 'missing',
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error('expected salvage result');

    expect(result.document.scenarios.map((item) => item.id)).toEqual(['keep-me']);
    expect(result.document.activeScenarioId).toBe('keep-me');
    expect(result.warnings.map((warning) => warning.code)).toContain('activeScenarioMissing');
    expect(result.warnings.map((warning) => warning.code)).toContain('documentRepaired');
  });
});
