import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { ViewerApi } from '../ids/ids.types';
import { buildAndPersistCache, buildAndPersistCacheWithWorkers, buildAndPersistFromIter } from '../ids/ids.adapter';
import { idsDb } from '../ids/ids.db';
import { computeModelKey } from '../ids/ids.hash';
import { idsStore } from '../ids/ids.store';
import { RequirementOperator } from '../ids/ids.types';
import useFilterEngine from './useFilterEngine';
import CircularProgress from '@mui/material/CircularProgress';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';

// Lightweight globalId extractor for raw element items (fallback when iterating)
const extractGlobalIdLocal = (raw: any): string | null => {
  if (!raw || typeof raw !== 'object') return null;
  // common keys
  const keys = ['GlobalId', 'globalId', 'GlobalID', 'guid', 'GUID', 'Guid'];
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // dive into object for potential nested identifiers
  if (raw.data && typeof raw.data === 'object') return extractGlobalIdLocal(raw.data);
  return null;
};

// Helper to wrap a promise with a timeout
const promiseWithTimeout = async <T,>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> => {
  let timeoutId: any;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      try { if (onTimeout) onTimeout(); } catch {}
      reject(new Error('timeout'));
    }, ms);
  });
  try {
    const res = await Promise.race([p, timeout]) as T;
    clearTimeout(timeoutId);
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
};

type Props = {
  open: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
};

const DEFAULT_FIELD = 'GlobalId';

const OPERATORS: RequirementOperator[] = [
  'equals',
  'contains',
  'matches',
  'exists',
  'not-equals',
  'greater-than',
  'less-than',
];

export default function ModelFilterDialog({ open, onClose, viewerApi }: Props) {
  const [field, setField] = useState<string>(DEFAULT_FIELD);
  const [operator, setOperator] = useState<RequirementOperator>('equals');
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<'current' | 'all'>('current');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryCount, setSummaryCount] = useState<number | null>(null);

  const { runFilter, running, progress, resultCount, cancel, resultIds } = useFilterEngine(viewerApi as any);
  const [fieldOptions, setFieldOptions] = useState<Array<{ value: string; label: string; group?: string }>>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [ifcTypes, setIfcTypes] = useState<string[]>([]);
  const [selectedIfcTypes, setSelectedIfcTypes] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total?: number } | null>(null);
  const [scanLogs, setScanLogs] = useState<string[]>([]);

  const pushLog = (msg: string) => {
    try { console.log(msg); } catch {}
    setScanLogs((s) => {
      const next = s.concat(msg);
      if (next.length > 200) return next.slice(next.length - 200);
      return next;
    });
  };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'select' | 'cache' | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [persistProgress, setPersistProgress] = useState<{ done: number; total?: number; propertiesDone?: number; propertiesTotal?: number } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const [resumeMeta, setResumeMeta] = useState<any | null>(null);
  const [persistentKey, setPersistentKey] = useState<string | null>(null);
  const [checkingResume, setCheckingResume] = useState(false);

  useEffect(() => {
    if (!open) {
      setField(DEFAULT_FIELD);
      setOperator('equals');
      setValue('');
      setMode('current');
    }
  }, [open]);

  // Populate field dropdown from IFC psets and Attributes by sampling elements
  useEffect(() => {
    let mounted = true;
    const loadFields = async () => {
      if (!viewerApi) return;
      setFieldsLoading(true);
      try {
        // Prefer listGlobalIds + getElementPropsFast for fast sampling
        const ids = (typeof viewerApi.listGlobalIds === 'function') ? await viewerApi.listGlobalIds() : [];
        const sampleCount = Math.min(300, ids.length || 300);
        const sampleIds = ids.slice(0, sampleCount);
        const psetMap = new Map<string, Set<string>>();
        const attrSet = new Set<string>();
        for (let i = 0; i < sampleIds.length; i++) {
          const gid = sampleIds[i];
          try {
            const props = await (viewerApi.getElementPropsFast ? viewerApi.getElementPropsFast(gid) : viewerApi.getElementProps(gid));
            if (props?.psets && typeof props.psets === 'object') {
              for (const [psetName, propsObj] of Object.entries(props.psets)) {
                if (!psetName) continue;
                const normalizedPset = String(psetName);
                if (!psetMap.has(normalizedPset)) psetMap.set(normalizedPset, new Set());
                const setRef = psetMap.get(normalizedPset)!;
                if (propsObj && typeof propsObj === 'object') {
                  for (const propKey of Object.keys(propsObj)) {
                    setRef.add(String(propKey));
                  }
                }
              }
            }
            if (props?.attributes && typeof props.attributes === 'object') {
              for (const a of Object.keys(props.attributes)) attrSet.add(String(a));
            }
          } catch (err) {
            // ignore individual element errors
          }
        }

        const options: Array<{ value: string; label: string; group?: string }> = [];
        // top-level defaults
        options.push({ value: 'GlobalId', label: 'GlobalId' });
        options.push({ value: 'ifcClass', label: 'IfcClass' });
        options.push({ value: 'Attributes.Name', label: 'Name', group: 'Attributes' });

        // Attributes
        const attrList = Array.from(attrSet).sort();
        for (const a of attrList) {
          options.push({ value: `Attributes.${a}`, label: `Attributes / ${a}`, group: 'Attributes' });
        }

        // Psets
        const psetNames = Array.from(psetMap.keys()).sort();
        for (const p of psetNames) {
          const props = Array.from(psetMap.get(p) ?? []).sort();
          for (const prop of props) {
            options.push({ value: `${p}.${prop}`, label: `${p} / ${prop}`, group: p });
          }
        }

        if (mounted) setFieldOptions(options);
        // populate default IFC types (common classes) for the selector
        if (mounted) setIfcTypes(['Wall', 'Door', 'Window', 'Column', 'Beam', 'Slab', 'Roof', 'Stair', 'CurtainWall', 'Duct', 'Pipe', 'Space', 'FurnishingElement']);
      } catch (err) {
        // ignore
      } finally {
        if (mounted) setFieldsLoading(false);
      }
    };

    if (open && viewerApi) loadFields();
    return () => {
      mounted = false;
    };
  }, [open, viewerApi]);

  const scanClasses = async () => {
    if (!viewerApi) return;
    setScanning(true);
    setScanProgress({ done: 0 });
    try {
  pushLog('[ModelFilterDialog] scanClasses: starting scan');
      // Try fast path: prefer selected IDs (very fast) then listGlobalIds (guarded by timeout)
      let ids: string[] = [];
      try {
        if (typeof viewerApi.getSelectedGlobalIds === 'function') {
          try {
            const sel = await promiseWithTimeout(viewerApi.getSelectedGlobalIds(), 5000, () => pushLog('[ModelFilterDialog] scanClasses: getSelectedGlobalIds timed out'));
            if (Array.isArray(sel) && sel.length > 0) {
              ids = sel.slice();
              pushLog(`[ModelFilterDialog] scanClasses: getSelectedGlobalIds returned ${ids.length} ids`);
            } else {
              pushLog('[ModelFilterDialog] scanClasses: getSelectedGlobalIds returned no ids');
            }
          } catch (err) {
            pushLog(`[ModelFilterDialog] scanClasses: getSelectedGlobalIds failed: ${String(err)}`);
          }
        }
        if (ids.length === 0 && typeof viewerApi.listGlobalIds === 'function') {
          // Check quickly if there are any elements at all (this may also build the cache internally)
          try {
            if (typeof viewerApi.countElements === 'function') {
              const cnt = await promiseWithTimeout(viewerApi.countElements(), 10000, () => pushLog('[ModelFilterDialog] scanClasses: countElements timed out'));
              pushLog(`[ModelFilterDialog] scanClasses: countElements returned ${String(cnt)}`);
              if (typeof cnt === 'number' && cnt === 0) {
                pushLog('[ModelFilterDialog] scanClasses: No elements detected (countElements=0). Try loading fragments or build the cache via Add to cache.');
              }
            }
          } catch (err) {
            pushLog(`[ModelFilterDialog] scanClasses: countElements failed: ${String(err)}`);
          }

          // guard against viewer implementations that hang
          ids = await promiseWithTimeout(viewerApi.listGlobalIds(), 30000, () => pushLog('[ModelFilterDialog] scanClasses: listGlobalIds timed out (30s)'));
        }
      } catch (err) {
        pushLog(`[ModelFilterDialog] scanClasses: listGlobalIds failed: ${String(err)}`);
        ids = [];
      }
      pushLog(`[ModelFilterDialog] scanClasses: listGlobalIds returned ${ids?.length}`);
      const total = ids.length || undefined;
      setScanProgress({ done: 0, total });
      const classes = new Set<string>();
      const batch = 300;
      if (ids && ids.length) {
        for (let i = 0; i < ids.length; i += batch) {
          const slice = ids.slice(i, i + batch);
          pushLog(`[ModelFilterDialog] scanClasses: processing batch ${i}-${i + slice.length} (size ${slice.length})`);
          try {
            // Use allSettled together with per-call timeout so a single slow element doesn't abort the whole batch
            const settled = await Promise.allSettled(slice.map((gid) => promiseWithTimeout(
              viewerApi.getElementPropsFast ? viewerApi.getElementPropsFast(gid) : viewerApi.getElementProps(gid),
              10000,
              () => pushLog(`[ModelFilterDialog] scanClasses: getElementProps timed out for ${gid}`)
            )));
            for (const s of settled) {
              if (s.status === 'fulfilled') {
                const p = s.value as any;
                if (p && p.ifcClass) classes.add(String(p.ifcClass));
              } else {
                // log individual failures
                pushLog(`[ModelFilterDialog] scanClasses: element error ${String((s as any).reason)}`);
              }
            }
            pushLog(`[ModelFilterDialog] scanClasses: classes found so far ${classes.size}`);
          } catch (err) {
            pushLog(`[ModelFilterDialog] scanClasses: batch unexpected error ${String(err)}`);
            // ignore and continue
          }
          setScanProgress({ done: Math.min(i + batch, ids.length), total: ids.length });
        }
      } else if (typeof viewerApi.iterElements === 'function') {
  pushLog('[ModelFilterDialog] scanClasses: falling back to iterElements');
        // Fallback: iterate elements (may be slower)
        pushLog('[ModelFilterDialog] scanClasses: falling back to iterElements');
        let seen = 0;
        let hadAny = false;
        for await (const batchItems of viewerApi.iterElements({ batchSize: 256 })) {
          hadAny = true;
          if (!Array.isArray(batchItems)) continue;
          for (const item of batchItems) {
            const raw = (item as any).data;
            const gid = extractGlobalIdLocal(raw);
            if (!gid) continue;
            try {
              // guard per-element prop reads
              const p = await promiseWithTimeout(
                viewerApi.getElementPropsFast ? viewerApi.getElementPropsFast(gid) : viewerApi.getElementProps(gid),
                8000,
                () => pushLog(`[ModelFilterDialog] scanClasses: getElementProps timed out for ${gid}`)
              );
              if (p && p.ifcClass) classes.add(String(p.ifcClass));
            } catch (err) {
              pushLog(`[ModelFilterDialog] scanClasses: element props error for ${gid} - ${String(err)}`);
              // ignore
            }
            seen += 1;
            if (seen % 500 === 0) pushLog(`[ModelFilterDialog] scanClasses: iterated ${seen} elements, classes found ${classes.size}`);
          }
          setScanProgress({ done: seen });
        }
        if (!hadAny) {
          pushLog('[ModelFilterDialog] scanClasses: iterElements produced no batches — ensure the viewer has loaded fragments or try building the cache first (Add to cache).');
        }
      }
      const list = Array.from(classes).sort();
  pushLog(`[ModelFilterDialog] scanClasses: final classes found ${list.length} ${list.slice(0, 40).join(', ')}`);
      if (list.length) setIfcTypes(list);
    } catch (err) {
  pushLog(`[ModelFilterDialog] scanClasses: failed ${String(err)}`);
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  };

  const handleApply = useCallback(async () => {
    if (!viewerApi) return;
    await runFilter({ field, operator, value, mode });
  }, [runFilter, field, operator, value, mode, viewerApi]);

  // Compute persistent key for current resultIds (used to check resume metadata)
  useEffect(() => {
    let mounted = true;
    const checkResume = async () => {
      if (!viewerApi || !resultIds || !resultIds.length) {
        if (mounted) { setResumeMeta(null); setPersistentKey(null); }
        return;
      }
      setCheckingResume(true);
      try {
        const token = resultIds.slice().sort().join('|');
        const extra = String(resultIds.length || '');
        const key = await computeModelKey({ modelUrl: token, extra });
        if (!mounted) return;
        setPersistentKey(key);
        try {
          const meta = await idsDb.getMetadata(key);
          if (!mounted) return;
          setResumeMeta(meta ?? null);
        } catch {
          if (mounted) setResumeMeta(null);
        }
      } catch (err) {
        if (mounted) { setResumeMeta(null); setPersistentKey(null); }
      } finally {
        if (mounted) setCheckingResume(false);
      }
    };
    checkResume();
    return () => { mounted = false; };
  }, [resultIds, viewerApi]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Parametric Filter (Model Explorer)</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', my: 1 }}>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel>Field</InputLabel>
            <Select value={field} label="Field" onChange={(e) => setField(String(e.target.value))}>
              {fieldsLoading ? (
                <MenuItem value="loading"><em>Loading…</em></MenuItem>
              ) : (
                <>
                  <MenuItem value="GlobalId">GlobalId</MenuItem>
                  <MenuItem value="ifcClass">IfcClass</MenuItem>
                  <MenuItem value="Attributes.Name">Name</MenuItem>
                  <MenuItem value="Attributes.Type">Type</MenuItem>
                  <MenuItem value="pset:ANY">Any Property Set (contains)</MenuItem>
                  {fieldOptions.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </>
              )}
            </Select>
            {fieldsLoading && <Box sx={{ position: 'absolute', right: 8, top: 10 }}><CircularProgress size={16} /></Box>}
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Operator</InputLabel>
            <Select value={operator} label="Operator" onChange={(e) => setOperator(e.target.value as RequirementOperator)}>
              {OPERATORS.map((op) => (
                <MenuItem key={op} value={op}>{op}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField size="small" label="Value" value={value} onChange={(e) => setValue(e.target.value)} sx={{ flex: 1 }} />
        </Box>

        {/* IFC type selector - optional pre-filter to only process specific classes */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', my: 1 }}>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel>IFC Types (optional)</InputLabel>
            <Select
              multiple
              value={selectedIfcTypes}
              onChange={(e) => setSelectedIfcTypes(typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]))}
              renderValue={(selected) => (selected as string[]).join(', ')}
              label="IFC Types (optional)"
            >
              {ifcTypes.map((t) => (
                <MenuItem key={t} value={t}>
                  <Checkbox checked={selectedIfcTypes.indexOf(t) > -1} />
                  <ListItemText primary={t} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography variant="caption" color="text.secondary">Optional: limit expensive extraction to these IFC classes.</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
              <Button size="small" onClick={scanClasses} disabled={!viewerApi || scanning}>Scan classes</Button>
              <Button size="small" onClick={async () => {
                if (!viewerApi) return;
                pushLog('[ModelFilterDialog] Scan & Persist (iter): starting');
                setPersisting(true);
                setPersistProgress({ done: 0 });
                const controller = new AbortController();
                abortRef.current = controller;
                try {
                  const onProgress = (p: any) => {
                    setPersistProgress({ done: p.done ?? 0, total: p.total, propertiesDone: p.propertiesDone, propertiesTotal: p.propertiesTotal });
                    pushLog(`[ModelFilterDialog] Scan & Persist: persisted ${p.done ?? 0}${p.total ? ` / ${p.total}` : ''}`);
                  };
                  const persisted = await buildAndPersistFromIter(viewerApi as any, mode, onProgress, controller.signal);
                  pushLog(`[ModelFilterDialog] Scan & Persist: completed, persisted ${persisted?.length ?? 0} elements`);
                  setSummaryCount(persisted?.length ?? null);
                  setSummaryOpen(true);
                } catch (err) {
                  pushLog(`[ModelFilterDialog] Scan & Persist: failed ${String(err)}`);
                } finally {
                  setPersisting(false);
                  setPersistProgress(null);
                  abortRef.current = null;
                }
              }} disabled={!viewerApi || persisting || scanning}>Scan & Persist (iter)</Button>
              <Button size="small" onClick={async () => {
                if (!viewerApi) return;
                pushLog('[ModelFilterDialog] Diagnostics: starting');
                try {
                  if (typeof viewerApi.getSelectedGlobalIds === 'function') {
                    try {
                      const sel = await promiseWithTimeout(viewerApi.getSelectedGlobalIds(), 3000, () => pushLog('[ModelFilterDialog] Diagnostics: getSelectedGlobalIds timed out'));
                      pushLog(`[ModelFilterDialog] Diagnostics: getSelectedGlobalIds -> ${Array.isArray(sel) ? sel.length : String(sel)}`);
                    } catch (err) {
                      pushLog(`[ModelFilterDialog] Diagnostics: getSelectedGlobalIds failed: ${String(err)}`);
                    }
                  } else {
                    pushLog('[ModelFilterDialog] Diagnostics: getSelectedGlobalIds not implemented');
                  }

                  if (typeof viewerApi.countElements === 'function') {
                    try {
                      const cnt = await promiseWithTimeout(viewerApi.countElements(), 4000, () => pushLog('[ModelFilterDialog] Diagnostics: countElements timed out'));
                      pushLog(`[ModelFilterDialog] Diagnostics: countElements -> ${String(cnt)}`);
                    } catch (err) {
                      pushLog(`[ModelFilterDialog] Diagnostics: countElements failed: ${String(err)}`);
                    }
                  } else {
                    pushLog('[ModelFilterDialog] Diagnostics: countElements not implemented');
                  }

                  if (typeof viewerApi.listGlobalIds === 'function') {
                    try {
                      const ids = await promiseWithTimeout(viewerApi.listGlobalIds(), 5000, () => pushLog('[ModelFilterDialog] Diagnostics: listGlobalIds timed out'));
                      pushLog(`[ModelFilterDialog] Diagnostics: listGlobalIds -> ${Array.isArray(ids) ? ids.length : String(ids)}`);
                    } catch (err) {
                      pushLog(`[ModelFilterDialog] Diagnostics: listGlobalIds failed: ${String(err)}`);
                    }
                  } else {
                    pushLog('[ModelFilterDialog] Diagnostics: listGlobalIds not implemented');
                  }

                  if (typeof viewerApi.iterElements === 'function') {
                    try {
                      pushLog('[ModelFilterDialog] Diagnostics: trying one iterElements batch');
                      const it = viewerApi.iterElements({ batchSize: 50 })[Symbol.asyncIterator]();
                      const raceRaw = await Promise.race([it.next(), new Promise((_, rej) => setTimeout(() => rej(new Error('iterElements timeout')), 5000))]) as any;
                      const res = raceRaw as IteratorResult<any[]>;
                      if (res && !res.done && Array.isArray(res.value)) {
                        pushLog(`[ModelFilterDialog] Diagnostics: iterElements first batch size -> ${res.value.length}`);
                      } else {
                        pushLog('[ModelFilterDialog] Diagnostics: iterElements returned no batch or empty');
                      }
                    } catch (err) {
                      pushLog(`[ModelFilterDialog] Diagnostics: iterElements failed: ${String(err)}`);
                    }
                  } else {
                    pushLog('[ModelFilterDialog] Diagnostics: iterElements not implemented');
                  }
                } catch (err) {
                  pushLog(`[ModelFilterDialog] Diagnostics: unexpected error ${String(err)}`);
                }
                pushLog('[ModelFilterDialog] Diagnostics: done');
              }} disabled={!viewerApi || scanning}>Diagnostics</Button>
              {scanning && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={16} /><Typography variant="caption">Scanning…</Typography></Box>}
            </Box>
            {scanProgress && (
              <Box sx={{ mt: 1 }}>
                <LinearProgress variant={scanProgress.total ? 'determinate' : 'indeterminate'} value={scanProgress.total ? (scanProgress.done / Math.max(1, scanProgress.total)) * 100 : undefined} />
                <Typography variant="caption">Scanned {scanProgress.done}{scanProgress.total ? ` / ${scanProgress.total}` : ''}</Typography>
              </Box>
            )}
            {scanLogs.length > 0 && (
              <Box sx={{ mt: 1, maxHeight: 140, overflow: 'auto', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', p: 1, fontSize: 12 }}>
                {scanLogs.map((l, i) => <div key={i}>{l}</div>)}
              </Box>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', my: 1 }}>
          <FormControl size="small">
            <InputLabel>Scope</InputLabel>
            <Select value={mode} label="Scope" onChange={(e) => setMode(String(e.target.value) as any)}>
              <MenuItem value="current">Current Model (faster)</MenuItem>
              <MenuItem value="all">All Models (may be slow)</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            Warning: searching all models may be slow for large datasets. You will be prompted if result count &gt; 50k.
          </Typography>
        </Box>

        {/* Resume panel: when a persisted cache exists for the current result set */}
        {checkingResume ? (
          <Box sx={{ mt: 2 }}><Typography variant="caption">Checking for persisted caches…</Typography></Box>
        ) : resumeMeta ? (
          <Box sx={{ mt: 2, p: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
            <Typography variant="body2">A persisted cache exists for this result set.</Typography>
            <Typography variant="caption">Elements persisted: {resumeMeta.elementCount?.toLocaleString() ?? '—'} (updated {resumeMeta.timestamp ? new Date(resumeMeta.timestamp).toLocaleString() : '—'})</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <Button size="small" variant="contained" onClick={async () => {
                // Continue (resume): call persistence which will resume using stored parts
                if (!viewerApi || !persistentKey) return;
                try {
                  setPersisting(true);
                  const controller = new AbortController();
                  abortRef.current = controller;
                  const onProgress = (p: any) => setPersistProgress({ done: p.done, total: p.total, propertiesDone: p.propertiesDone, propertiesTotal: p.propertiesTotal });
                  const persisted = await buildAndPersistCacheWithWorkers(viewerApi as any, resultIds, onProgress, controller.signal);
                  setSummaryCount(persisted?.length ?? null);
                  setSummaryOpen(true);
                } catch (err) {
                  console.warn('Resume failed', err);
                } finally {
                  setPersisting(false);
                  setPersistProgress(null);
                  abortRef.current = null;
                }
              }}>Continue</Button>
              <Button size="small" color="inherit" onClick={async () => {
                // Restart: remove parts and persist anew
                if (!persistentKey) return;
                try {
                  await idsDb.removeParts(persistentKey);
                  setResumeMeta(null);
                  // Trigger cache path by opening confirm flow
                  setPendingAction('cache');
                  setConfirmOpen(true);
                } catch (err) {
                  console.warn('Failed to remove persisted parts', err);
                }
              }}>Restart (clear)</Button>
            </Box>
          </Box>
        ) : null}

        {running && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant={progress?.total ? 'determinate' : 'indeterminate'} value={progress?.total ? (progress.done / Math.max(1, progress.total)) * 100 : undefined} />
            <Typography variant="caption">Found {resultCount} matching elements…</Typography>
          </Box>
        )}
        {!running && resultCount > 0 && (
          <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
            <Typography variant="body2">Found {resultCount} matches ({resultIds.length} collected)</Typography>
            <Button size="small" onClick={async () => {
                if (resultCount > 50000) {
                  setPendingAction('select');
                  setConfirmOpen(true);
                } else {
                  if (viewerApi?.selectGlobalIds) await Promise.resolve(viewerApi.selectGlobalIds(resultIds));
                }
              }} disabled={!viewerApi?.selectGlobalIds}>Select results</Button>
            <Button size="small" onClick={async () => {
                if (resultCount > 50000) {
                  setPendingAction('cache');
                  setConfirmOpen(true);
                } else {
                  if (viewerApi?.addToCache) await Promise.resolve(viewerApi.addToCache(resultIds));
                }
              }} disabled={!viewerApi?.addToCache}>Add results to cache</Button>
            <Button size="small" onClick={async () => {
              // Run IDS on found results via selected-only mode
              try {
                if (!viewerApi) return;
                if (viewerApi.selectGlobalIds) await Promise.resolve(viewerApi.selectGlobalIds(resultIds));
                // Set IDS store to selected-only and open panel + run check
                const { setValidationMode, runCheck, setIdsXmlText } = await import('../ids/ids.store').then(m => m.idsStore);
                setValidationMode('selected');
                // Open IDS panel and run check
                // We cannot directly open the panel here; the caller UI will handle opening. Just run check if viewerApi available
                await runCheck(viewerApi);
              } catch (error) {
                console.warn('Failed to run IDS on results', error);
              }
            }} disabled={!viewerApi}>Use as IDS input</Button>
          </Box>
        )}
        {persisting && persistProgress && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant={persistProgress.total ? 'determinate' : 'indeterminate'} value={persistProgress.total ? (persistProgress.done / Math.max(1, persistProgress.total)) * 100 : undefined} />
            <Typography variant="caption">Persisted {persistProgress.done.toLocaleString()} / {persistProgress.total?.toLocaleString() ?? '—'}</Typography>
            {/* Properties-level progress, when available */}
            {typeof persistProgress.propertiesDone === 'number' && (
              <Box sx={{ mt: 1 }}>
                <LinearProgress variant={persistProgress.propertiesTotal ? 'determinate' : 'indeterminate'} value={persistProgress.propertiesTotal ? (persistProgress.propertiesDone / Math.max(1, persistProgress.propertiesTotal)) * 100 : undefined} />
                <Typography variant="caption">Properties processed {persistProgress.propertiesDone.toLocaleString()} / {persistProgress.propertiesTotal?.toLocaleString() ?? '—'}</Typography>
              </Box>
            )}
          </Box>
        )}

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <DialogTitle>Large result set</DialogTitle>
          <DialogContent>
            <Typography>This operation will affect {resultCount.toLocaleString()} elements. This may be slow and cause UI stutter. Are you sure you want to continue?</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)} color="inherit">Cancel</Button>
            <Button onClick={async () => {
              setConfirmOpen(false);
              if (pendingAction === 'select') {
                if (viewerApi?.selectGlobalIds) await Promise.resolve(viewerApi.selectGlobalIds(resultIds));
              } else if (pendingAction === 'cache') {
                // Large set: perform streaming build-and-persist using workers
                try {
                  setPersisting(true);
                  // If user selected IFC types, prefilter the resultIds by ifcClass to avoid costly extraction
                  let idsToPersist = resultIds.slice();
                  if (selectedIfcTypes && selectedIfcTypes.length > 0 && viewerApi?.getElementPropsFast) {
                    const batch = 200;
                    const total = idsToPersist.length;
                    let kept: string[] = [];
                    for (let i = 0; i < total; i += batch) {
                      const slice = idsToPersist.slice(i, i + batch);
                      // update prefilter progress
                      setPersistProgress({ done: i, total, propertiesDone: 0, propertiesTotal: undefined });
                      try {
                        const propsArr = await Promise.all(slice.map((gid: string) => viewerApi.getElementPropsFast ? viewerApi.getElementPropsFast(gid) : viewerApi.getElementProps(gid)));
                        for (let j = 0; j < slice.length; j++) {
                          const p = propsArr[j];
                          const gid = slice[j];
                          const cls = p?.ifcClass ? String(p.ifcClass) : undefined;
                          if (cls && selectedIfcTypes.indexOf(cls) !== -1) kept.push(gid);
                        }
                      } catch (err) {
                        // ignore batch errors and continue
                      }
                    }
                    idsToPersist = kept;
                    // final progress before starting persist
                    setPersistProgress({ done: 0, total: idsToPersist.length, propertiesDone: 0, propertiesTotal: undefined });
                  } else {
                    setPersistProgress({ done: 0, total: idsToPersist.length });
                  }

                  const controller = new AbortController();
                  abortRef.current = controller;
                  const onProgress = (p: any) => setPersistProgress({ done: p.done, total: p.total, propertiesDone: p.propertiesDone, propertiesTotal: p.propertiesTotal });
                  const persisted = await buildAndPersistCacheWithWorkers(viewerApi as any, idsToPersist, onProgress, controller.signal);
                  setSummaryCount(persisted?.length ?? null);
                  setSummaryOpen(true);
                } catch (error) {
                  console.warn('Failed to build/persist large cache', error);
                } finally {
                  setPersisting(false);
                  setPersistProgress(null);
                  abortRef.current = null;
                }
              }
              setPendingAction(null);
            }} variant="contained">Proceed</Button>
          </DialogActions>
        </Dialog>
        <Dialog open={summaryOpen} onClose={() => setSummaryOpen(false)}>
          <DialogTitle>Persisting complete</DialogTitle>
          <DialogContent>
            <Typography>{summaryCount != null ? `${summaryCount.toLocaleString()} elements persisted.` : 'No elements persisted.'}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSummaryOpen(false)} color="inherit">Close</Button>
            <Button onClick={async () => {
              setSummaryOpen(false);
              // Offer a quick retry: run the same persist again
              try {
                setConfirmOpen(true);
                setPendingAction('cache');
              } catch (err) {
                console.warn('Retry failed', err);
              }
            }} variant="contained">Retry</Button>
          </DialogActions>
        </Dialog>
      </DialogContent>
      <DialogActions>
        {persisting ? (
          <>
            <Button onClick={() => { abortRef.current?.abort(); }} color="inherit">Cancel</Button>
            <Button onClick={onClose} color="inherit">Close</Button>
          </>
        ) : running ? (
          <Button onClick={cancel} color="inherit">Cancel</Button>
        ) : (
          <>
            <Button onClick={onClose} color="inherit">Close</Button>
            <Button onClick={handleApply} variant="contained" disabled={!viewerApi || !value.trim()}>Search</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
