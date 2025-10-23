import { useCallback, useRef, useState } from 'react';
import type { ViewerApi, IdsFilterPredicate } from '../ids/ids.types';

type FilterRequest = {
  field: string;
  operator: string;
  value: string;
  mode: 'current' | 'all';
};

export default function useFilterEngine(viewerApi: ViewerApi | null) {
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total?: number } | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [resultIds, setResultIds] = useState<string[]>([]);

  const makePredicate = useCallback((req: FilterRequest): ((props: any) => boolean) => {
    const { field, operator, value } = req;
    const v = value.trim().toLowerCase();
    if (operator === 'exists') {
      return (props) => {
        const val = String(props?.[field] ?? '') ;
        return val.length > 0;
      };
    }
    if (operator === 'contains') {
      return (props) => {
        const val = String(props?.[field] ?? '').toLowerCase();
        return val.includes(v);
      };
    }
    if (operator === 'matches') {
      try {
        const re = new RegExp(value, 'i');
        return (props) => re.test(String(props?.[field] ?? ''));
      } catch (e) {
        return () => false;
      }
    }
    if (operator === 'equals') {
      return (props) => String(props?.[field] ?? '').toLowerCase() === v;
    }
    if (operator === 'not-equals') {
      return (props) => String(props?.[field] ?? '').toLowerCase() !== v;
    }
    if (operator === 'greater-than' || operator === 'less-than') {
      const num = Number(value);
      if (Number.isNaN(num)) return () => false;
      if (operator === 'greater-than') return (props) => Number(props?.[field]) > num;
      return (props) => Number(props?.[field]) < num;
    }
    return () => false;
  }, []);

  const runFilter = useCallback(async (req: FilterRequest) => {
    if (!viewerApi) return;
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setRunning(true);
    setResultCount(0);
    setProgress({ done: 0 });

    try {
      // Fast path: if listGlobalIds and getElementProps are available, use them via batches
      if (typeof viewerApi.listGlobalIds === 'function' && typeof viewerApi.getElementProps === 'function') {
        const ids = await viewerApi.listGlobalIds();
        const total = ids.length;
        setProgress({ done: 0, total });
        const predicate = makePredicate(req);
        let found = 0;
        const batchSize = 500;
        const collected: string[] = [];
        const COLLECT_CAP = 200000; // safety cap
        for (let i = 0; i < ids.length; i += batchSize) {
          if (cancelRef.current) break;
          const batch = ids.slice(i, i + batchSize);
          const promises = batch.map((id) => viewerApi.getElementPropsFast ? viewerApi.getElementPropsFast(id) : viewerApi.getElementProps(id));
          const propsArr = await Promise.allSettled(promises);
          for (let j = 0; j < propsArr.length; j++) {
            const res = propsArr[j];
            if (res.status === 'fulfilled') {
              const payload = res.value;
              const props = { ...payload.attributes, ifcClass: payload.ifcClass };
              if (predicate(props)) found += 1;
              // collect id if under cap
              if (collected.length < COLLECT_CAP) collected.push(batch[j]);
            }
          }
          setProgress({ done: Math.min(total, i + batchSize), total });
          setResultCount(found);
          setResultIds(collected.slice());
        }
        setResultCount(found);
        setResultIds(collected.slice());
        return found;
      }

      // Fallback: iterate elements via iterElements if provided
      if (typeof viewerApi.iterElements === 'function') {
        const iterator = viewerApi.iterElements({ batchSize: 500 })[Symbol.asyncIterator]();
        let done = false;
        let processed = 0;
        let found = 0;
        const collected: string[] = [];
        const COLLECT_CAP = 200000;
        while (!done) {
          if (cancelRef.current) break;
          const next = await iterator.next();
          if (next.done) {
            done = true;
            break;
          }
          const batch = next.value;
          for (const item of batch) {
            const props = item.data as any;
            const predicate = makePredicate(req);
            if (predicate(props)) found += 1;
            const gid = String((props && (props.GlobalId ?? props.globalId ?? props.guid)) ?? '');
            if (gid && collected.length < COLLECT_CAP) collected.push(gid);
            processed += 1;
          }
          setProgress({ done: processed });
          setResultCount(found);
          setResultIds(collected.slice());
        }
        setResultCount(found);
        setResultIds(collected.slice());
        return found;
      }

      // If nothing available, return 0
      return 0;
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress(null);
    }
  }, [viewerApi, makePredicate]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { runFilter, running, progress, resultCount, resultIds, cancel } as const;
}

