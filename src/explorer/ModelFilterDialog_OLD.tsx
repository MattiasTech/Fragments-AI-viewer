import React, { useCallback, useEffect, useState } from 'react';
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
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import type { ViewerApi, RequirementOperator } from '../ids/ids.types';
import { extractPropertiesIncremental } from '../ids/ids.adapter';
import { idsDb } from '../ids/ids.db';
import useFilterEngine from './useFilterEngine';

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

type Props = {
  open: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
};

export default function ModelFilterDialog({ open, onClose, viewerApi }: Props) {
  // Filter state
  const [field, setField] = useState<string>(DEFAULT_FIELD);
  const [operator, setOperator] = useState<RequirementOperator>('equals');
  const [value, setValue] = useState('');
  
  // Extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total?: number; phase: string } | null>(null);
  const [selectedIfcTypes, setSelectedIfcTypes] = useState<string[]>([]);
  const [availableIfcTypes] = useState<string[]>([
    'IfcWall', 'IfcDoor', 'IfcWindow', 'IfcColumn', 'IfcBeam', 'IfcSlab', 
    'IfcRoof', 'IfcStair', 'IfcCurtainWall', 'IfcDuct', 'IfcPipe', 'IfcSpace'
  ]);
  const abortRef = React.useRef<AbortController | null>(null);
  
  // Cache status
  const [cacheStatus, setCacheStatus] = useState<{
    valid: boolean;
    elementCount?: number;
    timestamp?: number;
  } | null>(null);
  
  // Filter application mode
  const [filterMode, setFilterMode] = useState<'isolate' | 'color' | 'both'>('isolate');
  const [filterActive, setFilterActive] = useState(false);
  
  // Field options (populated from extracted data)
  const [fieldOptions, setFieldOptions] = useState<Array<{ value: string; label: string }>>([
    { value: 'GlobalId', label: 'GlobalId' },
    { value: 'ifcClass', label: 'IFC Class' },
    { value: 'Attributes.Name', label: 'Name' },
  ]);
  
  // Filter engine
  const { runFilter, running, progress, resultCount, cancel, resultIds } = useFilterEngine(viewerApi as any);
  
  // Reset on close
  useEffect(() => {
    if (!open) {
      setField(DEFAULT_FIELD);
      setOperator('equals');
      setValue('');
      setFilterActive(false);
    }
  }, [open]);
  
  // Check cache status on open
  useEffect(() => {
    let mounted = true;
    const checkCache = async () => {
      if (!viewerApi || !open) return;
      
      try {
        // Get current model signature
        if (typeof viewerApi.getModelSignature === 'function') {
          const sig = await viewerApi.getModelSignature();
          if (!mounted) return;
          
          // Check if we have cached data
          const key = await import('../ids/ids.hash').then(m => 
            m.computeModelKey({ modelUrl: sig.signature, extra: String(sig.elementCount) })
          );
          
          const valid = await idsDb.isSignatureValid(key, sig.signature);
          const meta = await idsDb.getMetadata(key);
          
          if (mounted) {
            setCacheStatus({
              valid,
              elementCount: meta?.elementCount,
              timestamp: meta?.timestamp,
            });
          }
        }
      } catch (error) {
        console.warn('Failed to check cache status', error);
        if (mounted) setCacheStatus(null);
      }
    };
    
    checkCache();
    return () => { mounted = false; };
  }, [viewerApi, open]);
  
  // Extract properties handler
  const handleExtractProperties = useCallback(async () => {
    if (!viewerApi) return;
    
    setExtracting(true);
    setExtractProgress({ done: 0, total: undefined, phase: 'Starting...' });
    
    const controller = new AbortController();
    abortRef.current = controller;
    
    try {
      const onProgress = (p: { done: number; total?: number; phase: string }) => {
        setExtractProgress(p);
      };
      
      await extractPropertiesIncremental(
        viewerApi,
        onProgress,
        controller.signal,
        {
          ifcTypes: selectedIfcTypes.length > 0 ? selectedIfcTypes : undefined,
          batchSize: 500,
        }
      );
      
      // Refresh cache status
      if (typeof viewerApi.getModelSignature === 'function') {
        const sig = await viewerApi.getModelSignature();
        const key = await import('../ids/ids.hash').then(m => 
          m.computeModelKey({ modelUrl: sig.signature, extra: String(sig.elementCount) })
        );
        const meta = await idsDb.getMetadata(key);
        setCacheStatus({
          valid: true,
          elementCount: meta?.elementCount,
          timestamp: meta?.timestamp,
        });
      }
      
      alert(`✅ Extraction complete! ${extractProgress?.done ?? 0} elements extracted.`);
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Extract properties failed:', error);
        alert(`❌ Extraction failed: ${error.message}`);
      }
    } finally {
      setExtracting(false);
      setExtractProgress(null);
      abortRef.current = null;
    }
  }, [viewerApi, selectedIfcTypes, extractProgress?.done]);
  
  // Apply filter handler
  const handleApplyFilter = useCallback(async () => {
    if (!viewerApi || !value.trim()) return;
    
    // Run the filter to get matching GlobalIds
    await runFilter({ field, operator, value, mode: 'all' });
    
    // resultIds will be populated by useFilterEngine
  }, [viewerApi, field, operator, value, runFilter]);
  
  // Apply filter to view (isolate/color)
  useEffect(() => {
    let mounted = true;
    const applyToView = async () => {
      if (!viewerApi || !resultIds || resultIds.length === 0 || running) return;
      
      try {
        if (filterMode === 'isolate' || filterMode === 'both') {
          await viewerApi.isolate(resultIds);
        }
        
        if (filterMode === 'color' || filterMode === 'both') {
          await viewerApi.color(resultIds, { r: 1, g: 0.65, b: 0.25, a: 1 }); // Orange
        }
        
        if (typeof viewerApi.fitViewTo === 'function') {
          await viewerApi.fitViewTo(resultIds);
        }
        
        if (mounted) {
          setFilterActive(true);
        }
      } catch (error) {
        console.warn('Failed to apply filter to view', error);
      }
    };
    
    if (resultIds && resultIds.length > 0 && !running) {
      applyToView();
    }
    
    return () => { mounted = false; };
  }, [resultIds, viewerApi, filterMode, running]);
  
  // Clear filter handler
  const handleClearFilter = useCallback(async () => {
    if (!viewerApi) return;
    
    try {
      await viewerApi.clearIsolation();
      await viewerApi.clearColors();
      setFilterActive(false);
      // Reset filter state
      cancel();
    } catch (error) {
      console.warn('Failed to clear filter', error);
    }
  }, [viewerApi, cancel]);
  
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Parametric Filter</DialogTitle>
      <DialogContent>
        {/* Cache Status */}
        {cacheStatus && (
          <Alert 
            severity={cacheStatus.valid ? 'success' : 'warning'} 
            sx={{ mb: 2 }}
          >
            {cacheStatus.valid ? (
              <>
                <strong>Cache Ready:</strong> {cacheStatus.elementCount?.toLocaleString()} elements
                {cacheStatus.timestamp && (
                  <> · Updated {new Date(cacheStatus.timestamp).toLocaleTimeString()}</>
                )}
              </>
            ) : (
              <>
                <strong>No cache</strong> - Extract properties first to enable filtering
              </>
            )}
          </Alert>
        )}
        
        {/* Extract Properties Section */}
        <Box sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            1. Extract Properties
          </Typography>
          
          <FormControl size="small" fullWidth sx={{ mb: 1 }}>
            <InputLabel>IFC Types (optional filter)</InputLabel>
            <Select
              multiple
              value={selectedIfcTypes}
              onChange={(e) => setSelectedIfcTypes(typeof e.target.value === 'string' ? [] : e.target.value as string[])}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(selected as string[]).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {availableIfcTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  <Checkbox checked={selectedIfcTypes.indexOf(type) > -1} />
                  <ListItemText primary={type} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          
          <Button
            fullWidth
            variant="contained"
            onClick={handleExtractProperties}
            disabled={extracting || !viewerApi}
          >
            {extracting ? 'Extracting...' : 'Extract Properties'}
          </Button>
          
          {extractProgress && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress
                variant={extractProgress.total ? 'determinate' : 'indeterminate'}
                value={extractProgress.total ? (extractProgress.done / extractProgress.total) * 100 : undefined}
              />
              <Typography variant="caption" color="text.secondary">
                {extractProgress.phase}
              </Typography>
            </Box>
          )}
        </Box>
        
        {/* Filter Section */}
        <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            2. Define Filter
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <FormControl size="small" sx={{ flex: 2 }}>
              <InputLabel>Field</InputLabel>
              <Select value={field} label="Field" onChange={(e) => setField(e.target.value)}>
                {fieldOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>Operator</InputLabel>
              <Select value={operator} label="Operator" onChange={(e) => setOperator(e.target.value as RequirementOperator)}>
                {OPERATORS.map((op) => (
                  <MenuItem key={op} value={op}>{op}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          
          <TextField
            fullWidth
            size="small"
            label="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            sx={{ mb: 1 }}
          />
          
          <Typography variant="caption" color="text.secondary" gutterBottom display="block">
            Filter Mode:
          </Typography>
          <ToggleButtonGroup
            value={filterMode}
            exclusive
            onChange={(e, newMode) => newMode && setFilterMode(newMode)}
            size="small"
            fullWidth
            sx={{ mb: 1 }}
          >
            <ToggleButton value="isolate">Isolate</ToggleButton>
            <ToggleButton value="color">Color</ToggleButton>
            <ToggleButton value="both">Both</ToggleButton>
          </ToggleButtonGroup>
          
          <Button
            fullWidth
            variant="contained"
            onClick={handleApplyFilter}
            disabled={!viewerApi || !value.trim() || running || !cacheStatus?.valid}
          >
            Apply Filter
          </Button>
          
          {running && progress && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress
                variant={progress.total ? 'determinate' : 'indeterminate'}
                value={progress.total ? (progress.done / progress.total) * 100 : undefined}
              />
              <Typography variant="caption">
                Processing {progress.done}{progress.total ? ` / ${progress.total}` : ''}...
              </Typography>
            </Box>
          )}
        </Box>
        
        {/* Results */}
        {filterActive && resultCount > 0 && (
          <Box sx={{ p: 2, bgcolor: 'success.light', borderRadius: 1, mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              <strong>Filter Active:</strong> {resultCount.toLocaleString()} elements match
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <Button size="small" variant="outlined" onClick={handleClearFilter}>
                Clear Filter
              </Button>
              {viewerApi?.selectGlobalIds && (
                <Button size="small" onClick={() => viewerApi.selectGlobalIds!(resultIds)}>
                  Select in Viewer
                </Button>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      
      <DialogActions>
        {extracting || running ? (
          <Button onClick={() => abortRef.current?.abort()} color="inherit">
            Cancel
          </Button>
        ) : null}
        <Button onClick={onClose} color="inherit">Close</Button>
      </DialogActions>
    </Dialog>
  );
}
