import type { EnergyDocument } from '../types';

const STORAGE_KEY = 'energy-lens.document.v1';

/**
 * 本地原始数据的读取结果：
 * - missing:  从未保存过（首次使用），正常进入示例
 * - unreadable: JSON 无法解析等真正的损坏，已无法挽回
 * - present:  读到了内容，合法性交给修复流程判断
 *
 * 注意：这里不再做严格的整体校验——"当前方案指向失效"和"数据损坏"
 * 是两件事，前者完全可以保留其余方案并修复指针。
 */
export type RawDocument =
  | { outcome: 'missing' }
  | { outcome: 'unreadable' }
  | { outcome: 'present'; data: unknown };

export function readRawDocument(): RawDocument {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { outcome: 'unreadable' };
  }
  if (!raw) return { outcome: 'missing' };
  try {
    return { outcome: 'present', data: JSON.parse(raw) };
  } catch {
    return { outcome: 'unreadable' };
  }
}

export function writeDocument(document: EnergyDocument): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}
