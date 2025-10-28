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
  validationMode: 'all' | 'visible' | 'selected'; // Validation scope: all elements, visible only, or selected only
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
  validationMode: 'all', // Default to validating all elements
};

let state = initialState;
const listeners = new Set<() => void>();
let currentValidationController: AbortController | null = null; // For cancellation support

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
  setValidationMode: (mode: 'all' | 'visible' | 'selected') => {
    setState((prev) => ({
      ...prev,
      validationMode: mode,
    }));
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

    // Check validation mode and filter elements accordingly
    let filterGlobalIds: string[] | undefined;
    if (state.validationMode === 'selected') {
      console.log('🎯 Selected Only mode is active');
      if (viewerApi.getSelectedGlobalIds) {
        console.log('🎯 Getting selected GlobalIds...');
        filterGlobalIds = await viewerApi.getSelectedGlobalIds();
        console.log('🎯 Selected GlobalIds:', filterGlobalIds);
        if (!filterGlobalIds || filterGlobalIds.length === 0) {
          console.error('❌ No elements selected');
          setState((prev) => ({
            ...prev,
            error: 'No elements selected. Please select elements or switch to another mode.',
          }));
          return;
        }
        console.log(`🎯 Validating ${filterGlobalIds.length} selected elements`);
      } else {
        console.warn('⚠️ getSelectedGlobalIds not available on viewerApi');
        setState((prev) => ({
          ...prev,
          error: 'Selected elements validation is not supported by this viewer.',
        }));
        return;
      }
    } else if (state.validationMode === 'visible') {
      console.log('👁️ Visible Only mode is active');
      if (viewerApi.getVisibleGlobalIds) {
        console.log('👁️ Getting visible GlobalIds...');
        filterGlobalIds = await viewerApi.getVisibleGlobalIds();
        console.log('👁️ Visible GlobalIds:', filterGlobalIds);
        if (!filterGlobalIds || filterGlobalIds.length === 0) {
          console.error('❌ No visible elements found');
          setState((prev) => ({
            ...prev,
            error: 'No visible elements found. Please make sure elements are visible or switch to another mode.',
          }));
          return;
        }
        console.log(`👁️ Validating ${filterGlobalIds.length} visible elements`);
      } else {
        console.warn('⚠️ getVisibleGlobalIds not available on viewerApi');
        setState((prev) => ({
          ...prev,
          error: 'Visible elements validation is not supported by this viewer.',
        }));
        return;
      }
    }

    setState((prev) => ({
      ...prev,
      isChecking: true,
      error: null,
      phase: 'BUILDING_PROPERTIES',
      progress: null,
    }));

    // Create abort controller for cancellation
    currentValidationController = new AbortController();
    const signal = currentValidationController.signal;

    try {
      // Check if cancelled before starting
      if (signal.aborted) {
        throw new Error('Validation cancelled');
      }

      const elements = await collectElementsForIds(viewerApi, {
        filterGlobalIds, // Pass the filter if validating selected only
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

      // Check if cancelled after collection
      if (signal.aborted) {
        throw new Error('Validation cancelled');
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

      // Add validated elements to cache for future use (e.g., highlighting)
      if (filterGlobalIds && filterGlobalIds.length > 0 && typeof viewerApi.addToCache === 'function') {
        console.log(`📦 Adding ${filterGlobalIds.length} validated elements to cache...`);
        try {
          await viewerApi.addToCache(filterGlobalIds);
          console.log('📦 Successfully updated cache with validated elements');
        } catch (error) {
          console.warn('📦 Failed to add elements to cache:', error);
        }
      }

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
      
      // Clear controller on success
      currentValidationController = null;
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
      
      // Clear controller on error
      currentValidationController = null;
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
  cancelValidation: () => {
    console.log('🛑 Cancelling IDS validation...');
    if (currentValidationController) {
      currentValidationController.abort();
      currentValidationController = null;
    }
    if (workerInstance) {
      // Send cancel message to worker
      workerInstance.postMessage({ type: 'cancel' });
    }
    setState((prev) => ({
      ...prev,
      isChecking: false,
      phase: 'IDLE',
      progress: null,
      error: 'Validation cancelled by user',
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
  const setValidationMode = useCallback(storeApi.setValidationMode, []);
  const cancelValidation = useCallback(storeApi.cancelValidation, []);
  return { 
    setIdsXmlText, 
    appendDocuments, 
    clearResults, 
    filterRows, 
    runCheck, 
    setValidationMode, 
    cancelValidation,
    invalidateCaches: storeApi.invalidateCaches 
  };
};

export const idsStore = storeApi;
