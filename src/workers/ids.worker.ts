import { XMLParser } from 'fast-xml-parser';
import { idsToJsonSchemas, validateIfcJson } from 'bsdd-ids-validator';
import type { DetailRow, RuleResult } from '@ids/ids.types';

type ValidateRequest = {
  type: 'validate';
  idsXml: string;
  elements: Array<{
    GlobalId: string;
    ifcClass: string;
    properties: Record<string, unknown>;
  }>;
  chunk?: number;
};

type CancelRequest = {
  type: 'cancel';
};

type WorkerInMessage = ValidateRequest | CancelRequest;

type PhaseMessage = { type: 'phase'; label: 'compiling' | 'validating' | 'finalizing' | 'idle' };
type ProgressMessage = { type: 'progress'; done: number; total: number };
type DoneMessage = { type: 'done'; rules: RuleResult[]; rows: DetailRow[] };
type ErrorMessage = { type: 'error'; message: string };

type WorkerOutMessage = PhaseMessage | ProgressMessage | DoneMessage | ErrorMessage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = self as any;

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

let cancelled = false;

const mergeRuleResults = (target: RuleResult, incoming: RuleResult) => {
  const appendUnique = (array: string[], values: string[]) => {
    const set = new Set(array);
    values.forEach((value) => {
      if (!set.has(value)) {
        set.add(value);
        array.push(value);
      }
    });
  };
  appendUnique(target.passed, incoming.passed);
  appendUnique(target.failed, incoming.failed);
  appendUnique(target.na, incoming.na);
};

const handleValidate = async (payload: ValidateRequest) => {
  const normalizedXml = payload.idsXml?.trim?.() ?? '';
  if (!normalizedXml) {
    ctx.postMessage({ type: 'error', message: 'Empty IDS payload received.' } satisfies WorkerOutMessage);
    return;
  }

  ctx.postMessage({ type: 'phase', label: 'compiling' } satisfies WorkerOutMessage);

  try {
    parser.parse(normalizedXml);
  } catch (error) {
    ctx.postMessage({ type: 'error', message: 'Failed to parse IDS XML. Please verify the file contents.' } satisfies WorkerOutMessage);
    return;
  }

  const ruleSchemas = idsToJsonSchemas(normalizedXml);
  if (!ruleSchemas.length) {
    ctx.postMessage({ type: 'error', message: 'No valid IDS specifications were found in the provided documents.' } satisfies WorkerOutMessage);
    return;
  }

  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const total = elements.length;
  const chunkSize = payload.chunk && payload.chunk > 0 ? payload.chunk : 200;

  ctx.postMessage({ type: 'phase', label: 'validating' } satisfies WorkerOutMessage);
  ctx.postMessage({ type: 'progress', done: 0, total } satisfies WorkerOutMessage);

  const aggregated = new Map<string, RuleResult>();
  const detailRows: DetailRow[] = [];

  for (let index = 0; index < elements.length; index += chunkSize) {
    if (cancelled) {
      ctx.postMessage({ type: 'error', message: 'Validation cancelled' } satisfies WorkerOutMessage);
      cancelled = false;
      return;
    }
    const chunk = elements.slice(index, index + chunkSize);
    const report = validateIfcJson(ruleSchemas, chunk);

    report.rules.forEach((rule) => {
      const existing = aggregated.get(rule.id);
      if (existing) {
        mergeRuleResults(existing, rule);
      } else {
        aggregated.set(rule.id, {
          id: rule.id,
          title: rule.title,
          passed: [...rule.passed],
          failed: [...rule.failed],
          na: [...rule.na],
        });
      }
    });

    report.rows.forEach((row: DetailRow) => {
      detailRows.push(row);
    });

    const processed = Math.min(index + chunk.length, total);
    ctx.postMessage({ type: 'progress', done: processed, total } satisfies WorkerOutMessage);
  }

  ctx.postMessage({ type: 'phase', label: 'finalizing' } satisfies WorkerOutMessage);

  const rules = Array.from(aggregated.values());
  const doneMessage: DoneMessage = { type: 'done', rules, rows: detailRows };
  ctx.postMessage(doneMessage satisfies WorkerOutMessage);
  ctx.postMessage({ type: 'phase', label: 'idle' } satisfies WorkerOutMessage);
};

ctx.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (message.type === 'validate') {
    cancelled = false;
    handleValidate(message).catch((error) => {
      const errMessage: ErrorMessage = {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown IDS worker error',
      };
      ctx.postMessage(errMessage satisfies WorkerOutMessage);
    });
  }
};
