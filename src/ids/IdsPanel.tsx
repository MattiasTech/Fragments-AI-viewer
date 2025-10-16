import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AssessmentIcon from '@mui/icons-material/Assessment';
import FilterListIcon from '@mui/icons-material/FilterList';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import RuleIcon from '@mui/icons-material/Rule';
import ClearIcon from '@mui/icons-material/Clear';
import type { DetailRow, IdsDocumentSource, Phase, RuleResult, ViewerApi } from './ids.types';
import { useIdsActions, useIdsStore } from './ids.store';
import { toCsv, toJson } from './ids.exports';

const SAMPLE_IDS = `<ids:ids xmlns:ids="http://standards.buildingsmart.org/IDS">
  <ids:specification ifcVersion="IFC4" name="Walls must have FireRating">
    <ids:applicability minOccurs="0" maxOccurs="unbounded">
      <ids:entity>
        <ids:name>
          <ids:simpleValue>IFCWALL</ids:simpleValue>
        </ids:name>
      </ids:entity>
    </ids:applicability>
    <ids:requirements>
      <ids:property cardinality="required">
        <ids:propertySet>
          <ids:simpleValue>Pset_WallCommon</ids:simpleValue>
        </ids:propertySet>
        <ids:baseName>
          <ids:simpleValue>FireRating</ids:simpleValue>
        </ids:baseName>
      </ids:property>
    </ids:requirements>
  </ids:specification>
  <ids:specification ifcVersion="IFC4" name="Pipes must be insulated">
    <ids:applicability minOccurs="0" maxOccurs="unbounded">
      <ids:entity>
        <ids:name>
          <ids:simpleValue>IFCFLOWSEGMENT</ids:simpleValue>
        </ids:name>
      </ids:entity>
    </ids:applicability>
    <ids:requirements>
      <ids:property cardinality="required">
        <ids:propertySet>
          <ids:simpleValue>Insulation</ids:simpleValue>
        </ids:propertySet>
        <ids:baseName>
          <ids:simpleValue>Insulation Type</ids:simpleValue>
        </ids:baseName>
        <ids:allowedValues>
          <ids:values>
            <ids:value>
              <ids:simpleValue>-V19</ids:simpleValue>
            </ids:value>
            <ids:value>
              <ids:simpleValue>Mineral Wool</ids:simpleValue>
            </ids:value>
          </ids:values>
        </ids:allowedValues>
      </ids:property>
    </ids:requirements>
  </ids:specification>
</ids:ids>`;

const STATUS_COLORS: Record<DetailRow['status'], string> = {
  PASSED: 'success.light',
  FAILED: 'error.light',
  NA: 'warning.light',
};

const STATUS_LABELS: Record<DetailRow['status'], string> = {
  PASSED: 'Passed',
  FAILED: 'Failed',
  NA: 'N/A',
};

const PHASE_LABELS: Record<Phase, string> = {
  IDLE: 'Idle',
  BUILDING_PROPERTIES: 'Building properties',
  CHECKING_IDS: 'Compiling IDS rules',
  COMPARING_DATA: 'Validating elements',
  FINALIZING: 'Finalizing report',
  DONE: 'Done',
  ERROR: 'Error',
};

const PHASE_COLORS: Record<Phase, 'default' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
  IDLE: 'default',
  BUILDING_PROPERTIES: 'info',
  CHECKING_IDS: 'primary',
  COMPARING_DATA: 'warning',
  FINALIZING: 'secondary',
  DONE: 'success',
  ERROR: 'error',
};

const chunkIds = (ids: string[], size = 2000): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

type DetailStatusFilter = 'ALL' | DetailRow['status'];

interface IdsPanelProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  viewerApi: ViewerApi | null;
  hasModel: boolean;
  expandSignal: number;
}

interface VirtualTableProps {
  rows: DetailRow[];
  height?: number;
  rowHeight?: number;
  onRowClick?: (row: DetailRow) => void;
}

const VirtualTable: React.FC<VirtualTableProps> = ({ rows, height = 360, rowHeight = 44, onRowClick }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = rows.length * rowHeight;
  const overscan = 6;
  const visibleCount = Math.ceil(height / rowHeight) + overscan;

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(rows.length, startIndex + visibleCount);
  const visibleRows = rows.slice(startIndex, endIndex);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    setScrollTop(node.scrollTop);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.addEventListener('scroll', handleScroll, { passive: true });
    return () => node.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        height,
        overflowY: 'auto',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        backgroundColor: 'background.paper',
      }}
    >
      <Box sx={{ height: totalHeight, position: 'relative' }}>
        {visibleRows.map((row, index) => {
          const top = (startIndex + index) * rowHeight;
          return (
            <Box
              key={`${row.ruleId}-${row.globalId}-${index}`}
              sx={{
                position: 'absolute',
                top,
                left: 0,
                right: 0,
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                backgroundColor: STATUS_COLORS[row.status] ?? 'background.paper',
                cursor: typeof onRowClick === 'function' ? 'pointer' : 'default',
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
              onClick={() => onRowClick?.(row)}
            >
              <Chip label={STATUS_LABELS[row.status]} size="small" color={row.status === 'FAILED' ? 'error' : row.status === 'PASSED' ? 'success' : 'warning'} />
              <Typography variant="body2" sx={{ minWidth: 120, fontWeight: 600 }} title={row.ruleId}>
                {row.ruleId}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1 }} noWrap title={row.ruleTitle}>
                {row.ruleTitle}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 140 }} noWrap title={row.globalId}>
                {row.globalId}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 110 }} noWrap title={row.ifcClass}>
                {row.ifcClass}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 180 }} noWrap title={row.propertyPath}>
                {row.propertyPath ?? '—'}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 160 }} noWrap title={row.expected}>
                {row.expected ?? '—'}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 160 }} noWrap title={row.actual}>
                {row.actual ?? '—'}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 220 }} noWrap title={row.reason}>
                {row.reason ?? '—'}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const IdsPanel: React.FC<IdsPanelProps> = ({ isOpen, onOpen, onClose, viewerApi, hasModel, expandSignal }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 620, height: 560 });
  const resizeOriginRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const resizingRef = useRef(false);

  const { setIdsXmlText, appendDocuments, clearResults, runCheck, filterRows } = useIdsActions();

  const idsXmlText = useIdsStore((store) => store.idsXmlText);
  const idsFileNames = useIdsStore((store) => store.idsFileNames);
  const isChecking = useIdsStore((store) => store.isChecking);
  const phase = useIdsStore((store) => store.phase);
  const progress = useIdsStore((store) => store.progress);
  const rules = useIdsStore((store) => store.rules);
  const rows = useIdsStore((store) => store.rows);
  const filteredRows = useIdsStore((store) => store.filteredRows);
  const error = useIdsStore((store) => store.error);

  const [activeTab, setActiveTab] = useState<'summary' | 'details'>('summary');
  const [detailSearch, setDetailSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DetailStatusFilter>('ALL');
  const [ruleFilter, setRuleFilter] = useState<string>('ALL');

  const tooltipSlotProps = useMemo(() => ({
    popper: {
      sx: { zIndex: 4000 },
    },
  }), []);

  const aggregateCounts = useMemo(() => {
    return rules.reduce(
      (acc, rule) => {
        acc.pass += rule.passed.length;
        acc.fail += rule.failed.length;
        acc.na += rule.na.length;
        return acc;
      },
      { pass: 0, fail: 0, na: 0 }
    );
  }, [rules]);

  const shouldRenderStatus = phase !== 'IDLE';
  const statusLabel = PHASE_LABELS[phase];
  const statusChipColor = PHASE_COLORS[phase];

  let progressVariant: 'determinate' | 'indeterminate' = 'indeterminate';
  let progressValue: number | undefined;
  let progressCaption: string | undefined;

  if (phase === 'DONE') {
    progressVariant = 'determinate';
    progressValue = 100;
    progressCaption = 'Complete';
  } else if (phase === 'ERROR') {
    progressVariant = 'determinate';
    progressValue = 0;
    progressCaption = 'Failed';
  } else if (progress && progress.total > 0) {
    const clampedDone = Math.min(progress.done, progress.total);
    progressVariant = 'determinate';
    progressValue = Math.max(0, Math.min((clampedDone / progress.total) * 100, 100));
    progressCaption = `${clampedDone} / ${progress.total}`;
  } else if (isChecking) {
    progressCaption = 'Working…';
  }

  const progressProps =
    progressVariant === 'determinate'
      ? ({ variant: 'determinate', value: progressValue ?? 0 } as const)
      : ({ variant: 'indeterminate' } as const);

  const hasIdsContent = Boolean(idsXmlText.trim().length);

  const handleFilesSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const contents = await Promise.all(
      files.map((file) =>
        new Promise<IdsDocumentSource>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, content: String(reader.result ?? '') });
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read IDS file.'));
          reader.readAsText(file);
        })
      )
    );
    appendDocuments(contents);
    event.target.value = '';
  }, [appendDocuments]);

  const handlePasteSample = useCallback(() => {
    setIdsXmlText(SAMPLE_IDS.trim(), { fileNames: ['Sample IDS'] });
    clearResults();
  }, [setIdsXmlText, clearResults]);

  const handleClearIds = useCallback(() => {
    setIdsXmlText('', { fileNames: [] });
    clearResults();
  }, [setIdsXmlText, clearResults]);

  const handleRunCheck = useCallback(async () => {
    if (!viewerApi) return;
    await runCheck(viewerApi);
    setActiveTab('summary');
  }, [runCheck, viewerApi]);

  useEffect(() => {
    if (!isOpen) {
      setIsMinimized(false);
      setActiveTab('summary');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setIsMinimized(false);
  }, [expandSignal, isOpen]);

  const applyFilterEffect = useCallback(() => {
    if (!rows.length) {
      filterRows(null);
      return;
    }
    const lowered = detailSearch.trim().toLowerCase();
    const statusValue = statusFilter === 'ALL' ? null : statusFilter;
    const ruleValue = ruleFilter === 'ALL' ? null : ruleFilter;
    
    filterRows((row) => {
      if (statusValue && row.status !== statusValue) return false;
      if (ruleValue && row.ruleId !== ruleValue) return false;
      if (!lowered) return true;
      const haystack = [
        row.globalId,
        row.ifcClass,
        row.propertyPath,
        row.expected,
        row.actual,
        row.reason,
        row.ruleTitle,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(lowered);
    });
  }, [rows, detailSearch, statusFilter, ruleFilter, filterRows]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      applyFilterEffect();
    }, 120);
    return () => window.clearTimeout(handle);
  }, [applyFilterEffect]);

  const handleRuleHighlight = useCallback(async (rule: RuleResult) => {
    if (!viewerApi) return;
    const failed = Array.from(new Set(rule.failed));
    const passed = Array.from(new Set(rule.passed));
    const target = failed.length ? failed : passed;
    try {
      await Promise.resolve(viewerApi.clearColors());
      if (viewerApi.clearIsolation) {
        await Promise.resolve(viewerApi.clearIsolation());
      }
    } catch (error) {
      console.warn('Failed to reset viewer colors before highlighting rule', error);
    }
    try {
      if (typeof viewerApi.color === 'function') {
        for (const chunk of chunkIds(failed)) {
          if (!chunk.length) continue;
          await Promise.resolve(viewerApi.color(chunk, { r: 1, g: 0.2, b: 0.2, a: 1 }));
        }
        for (const chunk of chunkIds(passed)) {
          if (!chunk.length) continue;
          await Promise.resolve(viewerApi.color(chunk, { r: 0.2, g: 0.7, b: 0.25, a: 1 }));
        }
      }
      if (target.length) {
        if (typeof viewerApi.isolate === 'function') {
          await Promise.resolve(viewerApi.isolate(target));
        }
        if (typeof viewerApi.fitViewTo === 'function') {
          await Promise.resolve(viewerApi.fitViewTo(target));
        }
      }
    } catch (error) {
      console.error('Failed to highlight IDS rule', error);
    }
  }, [viewerApi]);

  const handleRowClick = useCallback(async (row: DetailRow) => {
    if (!viewerApi || !row.globalId) return;
    try {
      // Ensure viewer API methods exist before calling
      if (typeof viewerApi.clearColors === 'function') {
        await Promise.resolve(viewerApi.clearColors());
      }
      if (typeof viewerApi.clearIsolation === 'function') {
        await Promise.resolve(viewerApi.clearIsolation());
      }
      if (typeof viewerApi.color === 'function') {
        await Promise.resolve(viewerApi.color([row.globalId], { r: 1, g: 0.6, b: 0, a: 1 }));
      }
      if (typeof viewerApi.isolate === 'function') {
        await Promise.resolve(viewerApi.isolate([row.globalId]));
      }
      if (typeof viewerApi.fitViewTo === 'function') {
        await Promise.resolve(viewerApi.fitViewTo([row.globalId]));
      }
    } catch (error) {
      console.error('Failed to focus element for IDS row', error);
    }
  }, [viewerApi]);

  const handleExportRule = useCallback((rule: RuleResult, format: 'csv' | 'json') => {
    const subset = rows.filter((row) => row.ruleId === rule.id);
    if (!subset.length) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `ids-rule-${rule.id}-${timestamp}`;
    if (format === 'csv') {
      downloadBlob(toCsv(subset, { includePassed: true, includeNA: true }), `${base}.csv`);
    } else {
      downloadBlob(toJson(subset), `${base}.json`);
    }
  }, [rows]);

  const handleExportFiltered = useCallback((format: 'csv' | 'json') => {
    if (!filteredRows.length) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `ids-details-${timestamp}`;
    if (format === 'csv') {
      downloadBlob(toCsv(filteredRows, { includePassed: true, includeNA: true }), `${base}.csv`);
    } else {
      downloadBlob(toJson(filteredRows), `${base}.json`);
    }
  }, [filteredRows]);

  const handleResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = nodeRef.current;
    if (!node) return;
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    resizingRef.current = true;
    const onMove = (moveEvent: PointerEvent) => {
      if (!resizingRef.current || !resizeOriginRef.current) return;
      const deltaX = moveEvent.clientX - resizeOriginRef.current.startX;
      const deltaY = moveEvent.clientY - resizeOriginRef.current.startY;
      setPanelSize((prev) => {
        const nextWidth = Math.max(420, resizeOriginRef.current!.width + deltaX);
        const nextHeight = Math.max(360, resizeOriginRef.current!.height + deltaY);
        if (nextWidth === prev.width && nextHeight === prev.height) return prev;
        return { width: Math.round(nextWidth), height: Math.round(nextHeight) };
      });
    };
    const onUp = () => {
      resizingRef.current = false;
      resizeOriginRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      viewerApi?.clearColors?.();
      viewerApi?.clearIsolation?.();
    };
  }, [isOpen, viewerApi]);

  if (!isOpen) {
    return (
      <Paper elevation={6} sx={{ position: 'fixed', bottom: 20, right: 160, zIndex: 1900 }}>
        <IconButton onClick={onOpen} title="Open IDS Checker">
          <RuleIcon />
        </IconButton>
      </Paper>
    );
  }

  return (
    <Draggable nodeRef={nodeRef} handle=".ids-panel-header" bounds="parent">
      <Paper
        ref={nodeRef}
        elevation={8}
        sx={{
          position: 'fixed',
          top: 140,
          right: 60,
          width: panelSize.width,
          height: isMinimized ? 'auto' : panelSize.height,
          minWidth: 420,
          minHeight: isMinimized ? 120 : 360,
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
          zIndex: 2000,
        }}
      >
        <Box
          className="ids-panel-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            cursor: 'move',
          }}
        >
          <Typography variant="subtitle1">IDS Checker</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton 
              size="small" 
              onClick={() => setIsMinimized((prev) => !prev)} 
              color="inherit"
              title={isMinimized ? "Expand panel" : "Minimize panel"}
            >
              {isMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
            </IconButton>
            <IconButton 
              size="small" 
              onClick={() => { setIsMinimized(false); onClose(); }} 
              color="inherit"
              title="Close IDS Checker"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>

        {!isMinimized && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2, gap: 2, minHeight: 0 }}>
            <Tabs
              value={activeTab}
              onChange={(_, value) => setActiveTab(value)}
              sx={{ minHeight: 'auto', '.MuiTab-root': { minHeight: 'auto', textTransform: 'none' } }}
            >
              <Tab value="summary" label="Summary" />
              <Tab value="details" label={`Details (${filteredRows.length})`} />
            </Tabs>

            {activeTab === 'summary' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden', minHeight: 0 }}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Tooltip title="Load IDS definition files" slotProps={tooltipSlotProps}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<FileUploadIcon />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Load IDS XML
                    </Button>
                  </Tooltip>
                  <Tooltip title="Insert a sample IDS specification" slotProps={tooltipSlotProps}>
                    <Button variant="outlined" size="small" onClick={handlePasteSample}>
                      Paste Sample
                    </Button>
                  </Tooltip>
                  <Tooltip title="Clear loaded IDS files and results" slotProps={tooltipSlotProps}>
                    <Button variant="outlined" size="small" color="inherit" startIcon={<RestartAltIcon />} onClick={handleClearIds}>
                      Clear
                    </Button>
                  </Tooltip>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFilesSelected}
                  />
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title="Validate the loaded model against IDS requirements" slotProps={tooltipSlotProps}>
                    <span>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={isChecking ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                        disabled={!hasIdsContent || !viewerApi || !hasModel || isChecking}
                        onClick={handleRunCheck}
                      >
                        {isChecking ? 'Checking…' : 'Run Check'}
                      </Button>
                    </span>
                  </Tooltip>
                </Box>

                {shouldRenderStatus && (
                  <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                      <Chip size="small" label={statusLabel} color={statusChipColor} />
                      {progressCaption && (
                        <Typography variant="caption" color="text.secondary">
                          {progressCaption}
                        </Typography>
                      )}
                    </Box>
                    <LinearProgress {...progressProps} sx={{ height: 6, borderRadius: 9999 }} />
                  </Paper>
                )}

                {idsFileNames.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Loaded IDS files
                    </Typography>
                    <List dense>
                      {idsFileNames.map((name) => (
                        <ListItem key={name} disablePadding>
                          <ListItemIcon sx={{ minWidth: 28 }}>
                            <RuleIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={name} />
                        </ListItem>
                      ))}
                    </List>
                  </Paper>
                )}

                {error && (
                  <Alert severity="error" variant="outlined">
                    {error}
                  </Alert>
                )}

                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Chip label={`Passed ${aggregateCounts.pass}`} color="success" variant="outlined" />
                  <Chip label={`Failed ${aggregateCounts.fail}`} color="error" variant="outlined" />
                  <Chip label={`N/A ${aggregateCounts.na}`} color="warning" variant="outlined" />
                </Box>

                <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
                  {rules.length === 0 ? (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        Load one or more IDS XML files and run the check to see rule results.
                      </Typography>
                    </Box>
                  ) : (
                    <List dense disablePadding>
                      {rules.map((rule) => (
                        <React.Fragment key={rule.id}>
                          <ListItem
                            secondaryAction={
                              <Box sx={{ display: 'flex', gap: 1 }}>
                                <Tooltip title="Highlight in viewer" slotProps={tooltipSlotProps}>
                                  <span>
                                    <IconButton size="small" onClick={() => handleRuleHighlight(rule)}>
                                      <HighlightAltIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="Export rule CSV" slotProps={tooltipSlotProps}>
                                  <span>
                                    <IconButton size="small" onClick={() => handleExportRule(rule, 'csv')}>
                                      <DownloadIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                                <Tooltip title="Export rule JSON" slotProps={tooltipSlotProps}>
                                  <span>
                                    <IconButton size="small" onClick={() => handleExportRule(rule, 'json')}>
                                      <AssessmentIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </Box>
                            }
                          >
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                                  <Typography variant="subtitle2">{rule.title}</Typography>
                                  <Chip size="small" label={`Pass ${rule.passed.length}`} color="success" />
                                  <Chip size="small" label={`Fail ${rule.failed.length}`} color="error" />
                                  <Chip size="small" label={`N/A ${rule.na.length}`} color="warning" />
                                </Box>
                              }
                              secondary={<Typography variant="caption" color="text.secondary">Rule ID: {rule.id}</Typography>}
                            />
                          </ListItem>
                          <Divider component="li" />
                        </React.Fragment>
                      ))}
                    </List>
                  )}
                </Paper>
              </Box>
            )}

            {activeTab === 'details' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1, minHeight: 0 }}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    value={detailSearch}
                    onChange={(event) => setDetailSearch(event.target.value)}
                    placeholder="Search details…"
                    InputProps={{ startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ) }}
                    sx={{ flex: 1, minWidth: 160 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Status</InputLabel>
                    <Select 
                      value={statusFilter} 
                      label="Status" 
                      onChange={(event) => setStatusFilter(event.target.value as DetailStatusFilter)}
                      MenuProps={{
                        sx: { zIndex: 4000 }
                      }}
                    >
                      <MenuItem value="ALL">All</MenuItem>
                      <MenuItem value="FAILED">Failed</MenuItem>
                      <MenuItem value="PASSED">Passed</MenuItem>
                      <MenuItem value="NA">N/A</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Rule</InputLabel>
                    <Select 
                      value={ruleFilter} 
                      label="Rule" 
                      onChange={(event) => setRuleFilter(event.target.value)}
                      MenuProps={{
                        sx: { zIndex: 4000 }
                      }}
                    >
                      <MenuItem value="ALL">All rules</MenuItem>
                      {rules.map((rule) => (
                        <MenuItem key={rule.id} value={rule.id}>
                          {rule.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Tooltip title="Reset filters" slotProps={tooltipSlotProps}>
                    <span>
                      <IconButton size="small" onClick={() => { setRuleFilter('ALL'); setStatusFilter('ALL'); setDetailSearch(''); }}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title="Download the filtered results as CSV" slotProps={tooltipSlotProps}>
                    <span>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={() => handleExportFiltered('csv')}
                        disabled={!filteredRows.length}
                      >
                        Export CSV
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title="Download the filtered results as JSON" slotProps={tooltipSlotProps}>
                    <span>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<AssessmentIcon />}
                        onClick={() => handleExportFiltered('json')}
                        disabled={!filteredRows.length}
                      >
                        Export JSON
                      </Button>
                    </span>
                  </Tooltip>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FilterListIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    Showing {filteredRows.length} of {rows.length} rows
                  </Typography>
                </Box>

                {filteredRows.length === 0 ? (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Adjust the filters or run the IDS check to populate detailed results.
                    </Typography>
                  </Paper>
                ) : (
                  <VirtualTable rows={filteredRows} onRowClick={handleRowClick} height={Math.max(220, panelSize.height - 280)} />
                )}
              </Box>
            )}
          </Box>
        )}

        {!isMinimized && (
          <Box
            onPointerDown={handleResizeStart}
            sx={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              width: 16,
              height: 16,
              cursor: 'nwse-resize',
              borderRight: '2px solid',
              borderBottom: '2px solid',
              borderColor: 'divider',
              opacity: 0.6,
              '&:hover': { opacity: 1 },
            }}
          />
        )}
      </Paper>
    </Draggable>
  );
};

export default IdsPanel;
