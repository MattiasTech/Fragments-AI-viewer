import { useCallback, useSyncExternalStore } from 'react';
import { collectElementsForIds, invalidateIdsElementsCache } from './ids.adapter';
import type {
  BuildProgress,
  DetailRow,
  IdsDocumentSource,
  IdsDoneMessage,
  IdsFilterPredicate,
  IdsPhaseMessage,
  IdsProgressMessage,
  IdsValidateRequest,
  IdsWorkerResponse,
  Phase,
  RuleResult,
  ViewerApi,
} from './ids.types';

interface IdsStoreState {
  idsXmlText: string;
  idsFileNames: string[];
  isChecking: boolean;
  phase: Phase;
  progress: BuildProgress | null;
  rules: RuleResult[];
  rows: DetailRow[];
  filteredRows: DetailRow[];
  filterDescription: string | null;
  error: string | null;
  lastRunAt: number | null;
}

const initialState: IdsStoreState = {
  idsXmlText: '',
  idsFileNames: [],
  isChecking: false,
  phase: 'IDLE',
  progress: null,
  rules: [],
  rows: [],
  filteredRows: [],
  filterDescription: null,
  error: null,
  lastRunAt: null,
};

let state = initialState;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('IDS store listener error', error);
    }
  });
};

const setState = (updater: (prev: IdsStoreState) => IdsStoreState) => {
  state = updater(state);
  notify();
};

let workerInstance: Worker | null = null;
let workerQueue: Promise<IdsDoneMessage> | null = null;

const getWorker = () => {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('../workers/ids.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return workerInstance;
};

const runWorker = (
  payload: IdsValidateRequest,
  options?: {
    onPhase?: (label: IdsPhaseMessage['label']) => void;
    onProgress?: (progress: IdsProgressMessage) => void;
  }
): Promise<IdsDoneMessage> => {
  const worker = getWorker();
  const task = new Promise<IdsDoneMessage>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<IdsWorkerResponse>) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'error') {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        reject(new Error(message.message || 'IDS worker failed'));
        return;
      }
      if (message.type === 'phase') {
        options?.onPhase?.(message.label);
        return;
      }
      if (message.type === 'progress') {
        options?.onProgress?.(message);
        return;
      }
      if (message.type === 'done') {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        resolve(message);
        return;
      }
    };

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      reject(event.error ?? new Error(event.message));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage(payload satisfies IdsValidateRequest);
  });

  workerQueue = task.finally(() => {
    workerQueue = null;
  });

  return task;
};

const resetResults = () => {
  setState((prev) => ({
    ...prev,
    rules: [],
    rows: [],
    filteredRows: [],
    filterDescription: null,
    error: null,
    lastRunAt: null,
    phase: 'IDLE',
    progress: null,
  }));
};

const storeApi = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,
  setIdsXmlText: (content: string, options?: { fileNames?: string[] }) => {
    const trimmed = content.replace(/\uFEFF/g, '').trim();
    const names = options?.fileNames ?? [];
    setState((prev) => ({
      ...prev,
      idsXmlText: trimmed,
      idsFileNames: names,
      error: null,
    }));
    resetResults();
  },
  appendDocuments: (sources: IdsDocumentSource[]) => {
    if (!sources.length) return;
    const current = storeApi.getState();
    const combinedTexts: string[] = [];
    if (current.idsXmlText.trim().length) {
      combinedTexts.push(current.idsXmlText.trim());
    }
    combinedTexts.push(...sources.map((src) => src.content.trim()).filter(Boolean));
    const mergedText = combinedTexts.join('\n\n');
    const names = [...current.idsFileNames, ...sources.map((src) => src.name)];
    storeApi.setIdsXmlText(mergedText, { fileNames: names });
  },
  clearResults: () => {
    resetResults();
  },
  filterRows: (predicate: IdsFilterPredicate | null, description?: string) => {
    setState((prev) => {
      if (!predicate) {
        return {
          ...prev,
          filteredRows: prev.rows,
          filterDescription: null,
        };
      }
      const filtered = prev.rows.filter((row) => {
        try {
          return predicate(row);
        } catch (error) {
          console.warn('IDS filter predicate threw an error', error);
          return true;
        }
      });
      return {
        ...prev,
        filteredRows: filtered,
        filterDescription: description ?? null,
      };
    });
  },
  runCheck: async (viewerApi: ViewerApi) => {
    if (!viewerApi) {
      setState((prev) => ({
        ...prev,
        error: 'Viewer API is not available.',
      }));
      return;
    }

    if (state.isChecking) {
      await workerQueue;
      return;
    }

    const text = state.idsXmlText.trim();
    if (!text) {
      setState((prev) => ({
        ...prev,
        error: 'Load at least one IDS XML file before running the check.',
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      isChecking: true,
      error: null,
      phase: 'BUILDING_PROPERTIES',
      progress: null,
    }));

    try {
      const elements = await collectElementsForIds(viewerApi, {
        onPhase: (phase) => {
          setState((prev) => ({
            ...prev,
            phase,
          }));
        },
        onProgress: (progress) => {
          setState((prev) => ({
            ...prev,
            progress,
          }));
        },
      });

      if (!elements.length) {
        throw new Error('No IFC elements were found in the current viewer.');
      }

      setState((prev) => ({
        ...prev,
        phase: 'CHECKING_IDS',
        progress: null,
      }));

      const phaseMap: Record<IdsPhaseMessage['label'], Phase> = {
        compiling: 'CHECKING_IDS',
        validating: 'COMPARING_DATA',
        finalizing: 'FINALIZING',
        idle: 'FINALIZING',
      };

      const result = await runWorker(
        { type: 'validate', idsXml: text, elements },
        {
          onPhase: (label) => {
            const mapped = phaseMap[label];
            if (mapped) {
              setState((prev) => ({
                ...prev,
                phase: mapped,
              }));
            }
          },
          onProgress: (progressMessage) => {
            setState((prev) => ({
              ...prev,
              progress: { done: progressMessage.done, total: progressMessage.total },
            }));
          },
        }
      );

      const rules = result.rules ?? [];
      const rows = result.rows ?? [];

      setState((prev) => ({
        ...prev,
        isChecking: false,
        rules,
        rows,
        filteredRows: rows,
        filterDescription: null,
        error: null,
        lastRunAt: Date.now(),
        phase: 'DONE',
        progress: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run IDS validation.';
      console.error('IDS run failed', error);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: message,
        phase: 'ERROR',
        progress: null,
      }));
    }
  },
  invalidateCaches: () => {
    invalidateIdsElementsCache();
    if (workerInstance) {
      workerInstance.terminate();
      workerInstance = null;
      workerQueue = null;
    }
    setState((prev) => ({
      ...prev,
      isChecking: false,
      phase: 'IDLE',
      progress: null,
    }));
  },
};

export type IdsStore = typeof storeApi;

export const useIdsStore = <T,>(selector: (state: IdsStoreState & IdsStore) => T): T => {
  return useSyncExternalStore(
    storeApi.subscribe,
    () => selector({ ...storeApi.getState(), ...storeApi }),
    () => selector({ ...storeApi.getState(), ...storeApi })
  );
};

export const useIdsStoreSelector = <T,>(selector: (state: IdsStoreState) => T): T => {
  return useSyncExternalStore(
    storeApi.subscribe,
    () => selector(storeApi.getState()),
    () => selector(storeApi.getState())
  );
};

export const useIdsActions = () => {
  const setIdsXmlText = useCallback(storeApi.setIdsXmlText, []);
  const appendDocuments = useCallback(storeApi.appendDocuments, []);
  const clearResults = useCallback(storeApi.clearResults, []);
  const filterRows = useCallback(storeApi.filterRows, []);
  const runCheck = useCallback(storeApi.runCheck, []);
  return { setIdsXmlText, appendDocuments, clearResults, filterRows, runCheck, invalidateCaches: storeApi.invalidateCaches };
};

export const idsStore = storeApi;
