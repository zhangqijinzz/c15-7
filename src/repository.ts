import { exampleScenario } from './domain';
import { repairDocument, type RepairIssue } from './documentRepair';
import { readRawDocument, writeDocument } from './services/storageService';
import type { EnergyDocument, EnergyScenario, Notice } from './types';

export interface LoadResult {
  document: EnergyDocument;
  /** 修复/回退发生时给用户的明确提示；首次使用无数据时为 null，不打扰用户 */
  notice: Notice | null;
}

export interface EnergyRepository {
  load(): LoadResult;
  save(document: EnergyDocument): void;
}

function exampleDocument(): EnergyDocument {
  return { version: 1, scenarios: [exampleScenario], activeScenarioId: exampleScenario.id };
}

export class LocalEnergyRepository implements EnergyRepository {
  load(): LoadResult {
    const raw = readRawDocument();
    if (raw.outcome === 'missing') {
      return { document: exampleDocument(), notice: null };
    }
    if (raw.outcome === 'unreadable') {
      return {
        document: exampleDocument(),
        notice: { kind: 'error', text: '本地数据无法读取，已为你重建示例方案，之前的内容无法恢复' },
      };
    }

    const { document, issues } = repairDocument(raw.data);
    if (!document) {
      // 修复后一个方案都救不回来，才回退示例
      return {
        document: exampleDocument(),
        notice: { kind: 'error', text: '本地数据已损坏且无法修复，已为你重建示例方案' },
      };
    }

    const notice = describeRepair(issues);
    if (issues.size > 0) {
      // 修复结果立刻落盘，避免每次加载都重复修复、重复提示
      try {
        writeDocument(document);
      } catch {
        // 落盘失败不影响本次使用：修复后的文档仍在内存中可继续编辑
      }
    }
    return { document, notice };
  }

  save(document: EnergyDocument): void {
    writeDocument(document);
  }
}

/** 有方案被丢弃时用 error，其余修复（指针收敛、旧结构迁移）用 info，保证用户可见但不恐慌 */
function describeRepair(issues: Set<RepairIssue>): Notice | null {
  if (issues.size === 0) return null;
  const kind: Notice['kind'] = issues.has('scenarios-dropped') ? 'error' : 'info';
  const lines: string[] = [];
  if (issues.has('active-realigned')) {
    lines.push('之前选中的方案已不存在，已自动切换到列表中的第一个方案');
  }
  if (issues.has('scenarios-dropped')) {
    lines.push('有部分方案无法识别已被移除，其余方案均已保留');
  }
  if (issues.has('legacy-version')) {
    lines.push('数据来自旧版本，已按当前版本自动迁移，请检查后重新保存');
  }
  if (issues.has('fields-repaired')) {
    lines.push('部分设备参数异常已自动修复，请确认修复结果');
  }
  return { kind, text: lines.join('；') };
}

export function findScenario(document: EnergyDocument, id: string): EnergyScenario | undefined {
  return document.scenarios.find((scenario) => scenario.id === id);
}
