import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleScenario } from '../domain';
import type { EnergyDocument } from '../types';
import { EnergyLensViewModel } from '../viewModel';
import type { EnergyRepository } from '../repository';

function makeRepository(): EnergyRepository & { data: EnergyDocument; save: ReturnType<typeof vi.fn> } {
  const data: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id };
  return { data, load: () => ({ document: data, notice: null }), save: vi.fn((next: EnergyDocument) => { data.scenarios = next.scenarios; data.activeScenarioId = next.activeScenarioId; }) };
}

describe('EnergyLensViewModel', () => {
  let repository: ReturnType<typeof makeRepository>;
  let vm: EnergyLensViewModel;
  beforeEach(() => { repository = makeRepository(); vm = new EnergyLensViewModel(repository); vm.initialize(); });

  it('initializes, persists edits, and recalculates results', () => {
    expect(vm.getState().status).toBe('ready');
    const before = vm.activeSummary?.total.monthlyKwh;
    vm.updateDevice('device-aircon', { dailyHours: 2 });
    expect(vm.activeSummary?.total.monthlyKwh).toBeLessThan(before ?? Infinity);
    expect(repository.save).toHaveBeenCalled();
  });

  it('keeps invalid values out of the document and exposes an error notice', () => {
    vm.updateDevice('device-aircon', { watts: -50 });
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toBe('功率不能为负数');
    expect(vm.activeScenario?.devices[0].watts).toBe(1200);
  });

  it('duplicates a scenario and can recover a saved document', () => {
    vm.duplicateActive();
    expect(vm.getState().document?.scenarios).toHaveLength(2);
    const recovered = new EnergyLensViewModel(repository);
    recovered.initialize();
    expect(recovered.getState().document?.scenarios).toHaveLength(2);
  });

  it('surfaces persistence failure as a recoverable error', () => {
    repository.save.mockImplementation(() => { throw new Error('quota'); });
    vm.addDevice();
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toContain('保存失败');
  });
});

describe('EnergyLensViewModel recovery notices', () => {
  it('surfaces the active-pointer realignment notice instead of silently switching', () => {
    const document: EnergyDocument = {
      version: 1,
      scenarios: [structuredClone(exampleScenario)],
      activeScenarioId: exampleScenario.id,
    };
    const repo: EnergyRepository = {
      load: () => ({ document, notice: { kind: 'info', text: '之前选中的方案已不存在，已自动切换到列表中的第一个方案' } }),
      save: vi.fn(),
    };
    const vm = new EnergyLensViewModel(repo);
    vm.initialize();
    expect(vm.getState().status).toBe('ready');
    expect(vm.getState().notice?.text).toContain('已自动切换');
    expect(vm.activeScenario?.id).toBe(exampleScenario.id);
  });

  it('enters error status when recovery had to drop scenarios', () => {
    const document: EnergyDocument = {
      version: 1,
      scenarios: [structuredClone(exampleScenario)],
      activeScenarioId: exampleScenario.id,
    };
    const repo: EnergyRepository = {
      load: () => ({ document, notice: { kind: 'error', text: '本地数据已损坏且无法修复，已为你重建示例方案' } }),
      save: vi.fn(),
    };
    const vm = new EnergyLensViewModel(repo);
    vm.initialize();
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice).not.toBeNull();
  });
});
