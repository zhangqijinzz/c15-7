import { exampleScenario } from './domain';
import { readStoredDocument, writeDocument } from './services/storageService';
import type { DocumentRepairWarning } from './services/storageService';
import type { EnergyDocument, EnergyScenario } from './types';

export interface DocumentLoadWarning {
  kind: 'info' | 'error';
  code: DocumentRepairWarning['code'] | 'documentReset';
  message: string;
}

export interface DocumentLoadResult {
  document: EnergyDocument;
  warnings: DocumentLoadWarning[];
  shouldPersist: boolean;
}

export interface EnergyRepository {
  load(): DocumentLoadResult | EnergyDocument;
  save(document: EnergyDocument): void;
}

export class LocalEnergyRepository implements EnergyRepository {
  load(): DocumentLoadResult {
    const stored = readStoredDocument();
    if (!stored) return this.exampleResult([]);

    if (stored.ok) {
      return {
        document: stored.document,
        warnings: stored.warnings.map((warning) => ({ ...warning, kind: 'info' as const })),
        shouldPersist: stored.repaired || stored.warnings.length > 0,
      };
    }

    return this.exampleResult([{
      kind: 'error',
      code: 'documentReset',
      message: stored.message,
    }]);
  }

  save(document: EnergyDocument): void {
    writeDocument(document);
  }

  private exampleResult(warnings: DocumentLoadWarning[]): DocumentLoadResult {
    return {
      document: { version: 1, scenarios: [exampleScenario], activeScenarioId: exampleScenario.id },
      warnings,
      shouldPersist: warnings.length > 0,
    };
  }
}

export function findScenario(document: EnergyDocument, id: string): EnergyScenario | undefined {
  return document.scenarios.find((scenario) => scenario.id === id);
}
