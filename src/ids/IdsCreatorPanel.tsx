import React, { useState, useMemo, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import FileOpenIcon from '@mui/icons-material/FileOpen';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListItemSecondaryAction from '@mui/material/ListItemSecondaryAction';
import EditIcon from '@mui/icons-material/Edit';
import SaveAsIcon from '@mui/icons-material/SaveAs';
import { ViewerApi, IdsSpecification } from './ids.types';
import { parseIds, generateIdsXml } from './ids.adapter';

export type IdsCreatorPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
  selectedItemData: Record<string, any> | null; // Live data from the selected element
  onValidate?: (idsXml: string) => void;
};

const IdsCreatorPanel: React.FC<IdsCreatorPanelProps> = ({
  isOpen,
  onClose,
  viewerApi,
  selectedItemData,
  onValidate,
}) => {
  const panelNodeRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [specifications, setSpecifications] = useState<IdsSpecification[]>([]);
  const [activeSpecId, setActiveSpecId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('new-project.ids');

  const updateSpecification = useCallback(
    (id: string, updater: (current: IdsSpecification) => IdsSpecification) => {
      setSpecifications((prev) => prev.map((spec) => (spec.id === id ? updater(spec) : spec)));
    },
    []
  );

  const removeSpecification = useCallback((id: string) => {
    setSpecifications((prev) => {
      const next = prev.filter((spec) => spec.id !== id);
      setActiveSpecId((prevActive) => {
        if (prevActive && prevActive !== id) return prevActive;
        return next[0]?.id ?? null;
      });
      return next;
    });
  }, []);

  const selectedItemJson = useMemo(() => {
    if (!selectedItemData) return null;
    try {
      const seen = new WeakSet();
      return JSON.stringify(
        selectedItemData,
        (key, value) => {
          if (typeof value === 'bigint') {
            return value.toString();
          }
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          return value;
        },
        2
      );
    } catch (error) {
      console.warn('Failed to stringify selected item data for IDS creator inspector', error);
      return 'Unable to display selected element properties.';
    }
  }, [selectedItemData]);

  const selectedItemSnapshot = useMemo(() => {
    if (!selectedItemJson || selectedItemJson.startsWith('Unable')) return null;
    try {
      return JSON.parse(selectedItemJson);
    } catch {
      return null;
    }
  }, [selectedItemJson]);

  // Build property rows from selected item data - ONLY PSETS
  const selectedItemProperties = useMemo(() => {
    if (!selectedItemSnapshot) return [];
    
    const rows: { label: string; value: string; psetName: string }[] = [];
    
    // Helper to format values
    const formatValue = (val: any): string => {
      if (val == null) return '—';
      if (typeof val === 'object') {
        if ('value' in val) return formatValue(val.value);
        if ('Value' in val) return formatValue(val.Value);
        if (val instanceof Date) return val.toLocaleString();
        if (Array.isArray(val)) return `[${val.length} items]`;
        return '[Object]';
      }
      return String(val);
    };
    
    // Extract property sets from IsDefinedBy array
    const isDefinedBy = selectedItemSnapshot.IsDefinedBy || selectedItemSnapshot.isDefinedBy;
    if (Array.isArray(isDefinedBy)) {
      isDefinedBy.forEach((pset: any) => {
        if (!pset || typeof pset !== 'object') return;
        
        // Try multiple ways to get pset name
        const psetName = pset.Name?.value || pset.name?.value || pset.Name || pset.name || pset.type;
        if (!psetName || typeof psetName !== 'string') return;
        
        // Try to get properties from multiple possible locations
        const hasProps = pset.HasProperties || pset.hasProperties || pset.properties || pset.Properties;
        if (!Array.isArray(hasProps)) return;
        
        hasProps.forEach((prop: any) => {
          if (!prop || typeof prop !== 'object') return;
          
          // Try multiple ways to get property name
          const propName = prop.Name?.value || prop.name?.value || prop.Name || prop.name;
          if (!propName || typeof propName !== 'string') return;
          
          // Try multiple ways to get property value
          const nominalValue = 
            prop.NominalValue?.value || 
            prop.nominalValue?.value || 
            prop.NominalValue || 
            prop.nominalValue ||
            prop.value ||
            prop.Value;
          
          const label = `${psetName} / ${propName}`;
          rows.push({ label, value: formatValue(nominalValue), psetName });
        });
      });
    }
    
    // Sort by pset name, then by property name for better readability
    rows.sort((a, b) => {
      if (a.psetName !== b.psetName) return a.psetName.localeCompare(b.psetName);
      return a.label.localeCompare(b.label);
    });
    
    return rows;
  }, [selectedItemSnapshot]);

  // Helper: recursively extract candidate property sets and property names from a sample object
  const extractPropertySetsFromSample = useCallback((sample: any): Record<string, string[]> => {
    const result: Record<string, Set<string>> = {};
    if (!sample || typeof sample !== 'object') return {};

    const addProps = (psetName: any, props: string[] | undefined) => {
      // Ensure psetName is a string, not an object
      const psetNameStr = typeof psetName === 'string' ? psetName : ((psetName as any)?.toString?.() === '[object Object]' ? null : String(psetName));
      if (!psetNameStr || psetNameStr === '[object Object]' || psetNameStr === 'null' || psetNameStr === 'undefined') return;
      if (!result[psetNameStr]) result[psetNameStr] = new Set<string>();
      if (Array.isArray(props)) props.forEach((p) => p && result[psetNameStr].add(String(p)));
    };
    
    const extractName = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === 'string') return val;
      if (typeof val === 'number') return String(val);
      if (typeof val === 'object') {
        // Common IFC pattern: { value: "actualValue" } or { Value: "actualValue" }
        if (val.value !== undefined) return extractName(val.value);
        if (val.Value !== undefined) return extractName(val.Value);
      }
      return null;
    };

    // Extract property sets from IsDefinedBy array (standard IFC structure from fragments library)
    try {
      const isDefinedBy = sample.IsDefinedBy || sample.isDefinedBy;
      if (Array.isArray(isDefinedBy)) {
        for (const pset of isDefinedBy) {
          if (!pset || typeof pset !== 'object') continue;
          
          // Get the property set name
          const psetName = extractName(pset.Name) || extractName(pset.name);
          if (!psetName) continue;
          
          // Get the properties from HasProperties array
          const hasProps = pset.HasProperties || pset.hasProperties;
          if (!Array.isArray(hasProps)) continue;
          
          const propNames: string[] = [];
          for (const prop of hasProps) {
            if (!prop || typeof prop !== 'object') continue;
            const propName = extractName(prop.Name) || extractName(prop.name);
            if (propName) propNames.push(propName);
          }
          
          if (propNames.length > 0) {
            addProps(psetName, propNames);
          }
        }
      }
    } catch (err) {
      console.error('Error extracting property sets from IsDefinedBy:', err);
    }

    // convert sets to arrays, prefer stable ordering
    const out: Record<string, string[]> = {};
    for (const [k, s] of Object.entries(result)) {
      if (k && k !== '[object Object]') {
        out[k] = Array.from(s).sort();
      }
    }
    return out;
  }, []);

  const activeSpecification = useMemo(
    () => specifications.find((spec) => spec.id === activeSpecId),
    [specifications, activeSpecId]
  );

  const handleRenameActiveSpecification = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!activeSpecId) return;
      const nextName = event.target.value;
      updateSpecification(activeSpecId, (current) => ({ ...current, name: nextName }));
    },
    [activeSpecId, updateSpecification]
  );

  const handleCaptureSelection = useCallback(
    (bucket: 'applicability' | 'requirements') => {
      if (!activeSpecId) return;
      if (!selectedItemSnapshot) {
        alert('Select an element in the viewer first to capture its data.');
        return;
      }

      updateSpecification(activeSpecId, (current) => {
        let sampleCopy: any = selectedItemSnapshot;
        try {
          sampleCopy = JSON.parse(JSON.stringify(selectedItemSnapshot));
        } catch {
          sampleCopy = selectedItemSnapshot;
        }
        
        // Extract ifcClass from _category.value or other fields
        let ifcClass: string | undefined = selectedItemSnapshot?.ifcClass;
        if (!ifcClass && selectedItemSnapshot?._category?.value) {
          ifcClass = selectedItemSnapshot._category.value;
        }
        if (!ifcClass && selectedItemSnapshot?.constructor?.name) {
          ifcClass = selectedItemSnapshot.constructor.name;
        }
        
        const entry = {
          capturedAt: new Date().toISOString(),
          sourceGlobalId:
            (selectedItemSnapshot?.GlobalId as string | undefined) || 
            (selectedItemSnapshot?._guid?.value as string | undefined) || 
            'unknown',
          ifcClass: ifcClass,
          sample: sampleCopy,
        };
        if (bucket === 'applicability') {
          return { ...current, applicability: [...current.applicability, entry] };
        }
        return { ...current, requirements: [...current.requirements, entry] };
      });
    },
    [activeSpecId, selectedItemSnapshot, updateSpecification]
  );

  const handleRemoveCapturedEntry = useCallback(
    (bucket: 'applicability' | 'requirements', index: number) => {
      if (!activeSpecId) return;
      updateSpecification(activeSpecId, (current) => {
        if (bucket === 'applicability') {
          const next = [...current.applicability];
          next.splice(index, 1);
          return { ...current, applicability: next };
        }
        const next = [...current.requirements];
        next.splice(index, 1);
        return { ...current, requirements: next };
      });
    },
    [activeSpecId, updateSpecification]
  );

  const handleAddSpecification = () => {
    const newId = `spec-${Date.now()}`;
    const newSpec: IdsSpecification = {
      id: newId,
      name: 'New Specification',
      description: '',
      applicability: [],
      requirements: [],
    };
    setSpecifications((prev) => [...prev, newSpec]);
    setActiveSpecId(newId);
  };

  // Property picker dialog state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSampleIndex, setPickerSampleIndex] = useState<number | null>(null);
  const [pickerPset, setPickerPset] = useState<string | null>(null);
  const [pickerProperty, setPickerProperty] = useState<string | null>(null);
  const [availablePsets, setAvailablePsets] = useState<Record<string, string[]>>({});
  const [ruleOperator, setRuleOperator] = useState<string>('equals');
  const [ruleValue, setRuleValue] = useState<string>('');

  const openPropertyPickerFor = useCallback((sampleIndex: number) => {
    const sample = (activeSpecification?.applicability?.[sampleIndex] as any)?.sample as Record<string, any> | undefined;
    if (!sample) return;
    const psets = extractPropertySetsFromSample(sample);
    setAvailablePsets(psets);
    setPickerSampleIndex(sampleIndex);
    setPickerPset(Object.keys(psets)[0] ?? null);
    setPickerProperty(Object.keys(psets)[0] ? (psets[Object.keys(psets)[0]][0] ?? null) : null);
    setRuleValue('');
    setPickerOpen(true);
  }, [activeSpecification]);

  const createRequirementRuleFromPicker = useCallback(() => {
    if (!activeSpecId || pickerSampleIndex == null || !pickerPset || !pickerProperty) return;
    const current = specifications.find((s) => s.id === activeSpecId);
    if (!current) return;
    const sample = (current.applicability?.[pickerSampleIndex] as any)?.sample as Record<string, any> | undefined;
    
    // Extract property value from IsDefinedBy structure
    let propValue: any = undefined;
    try {
      const isDefinedBy = sample?.IsDefinedBy || sample?.isDefinedBy;
      if (Array.isArray(isDefinedBy)) {
        for (const pset of isDefinedBy) {
          const psetName = pset?.Name?.value || pset?.name?.value;
          if (psetName === pickerPset) {
            const hasProps = pset.HasProperties || pset.hasProperties;
            if (Array.isArray(hasProps)) {
              for (const prop of hasProps) {
                const propName = prop?.Name?.value || prop?.name?.value;
                if (propName === pickerProperty) {
                  propValue = prop?.NominalValue?.value || prop?.nominalValue?.value || prop?.NominalValue || prop?.nominalValue;
                  break;
                }
              }
            }
            break;
          }
        }
      }
    } catch (err) {
      console.error('Error extracting property value:', err);
    }
    
    const rule: any = {
      id: `rule-${Date.now()}`,
      propertyPath: `${pickerPset}.${pickerProperty}`,
      operator: ruleOperator as any,
      value: ruleValue || (propValue != null ? String(propValue) : ''),
      sample: sample ?? null,
    };
    updateSpecification(activeSpecId, (cur) => {
      // if editing an existing requirement, replace it. Otherwise append.
      if ((editingRequirementIndexRef.current ?? null) != null) {
        const idx = editingRequirementIndexRef.current!;
        const next = [...cur.requirements];
        next[idx] = rule;
        editingRequirementIndexRef.current = null;
        return { ...cur, requirements: next };
      }
      return { ...cur, requirements: [...cur.requirements, rule] };
    });
    setPickerOpen(false);
  }, [activeSpecId, pickerSampleIndex, pickerPset, pickerProperty, ruleOperator, ruleValue, specifications, updateSpecification]);

  // editing index ref to survive renders without triggering effects
  const editingRequirementIndexRef = React.useRef<number | null>(null);

  const getSampleLabel = useCallback((item: any) => {
    if (!item) return 'Captured element';
    const sample = item.sample ?? item;
    const id = item.sourceGlobalId || sample?.GlobalId || sample?._guid || sample?.guid || (sample?.Tag && sample.Tag.value) || 'unknown';
    const ifcClass = item.ifcClass || (sample && sample._category && sample._category.value) || sample?.ifcClass || 'IfcElement';
    const name = (sample && ((sample.Name && sample.Name.value) || sample.ObjectType || sample.Name)) || undefined;
    if (id && id !== 'unknown') return `${ifcClass} (${id})`;
    if (name) return `${ifcClass} — ${String(name).substring(0, 40)}`;
    return `${ifcClass} (captured)`;
  }, []);

  const handleCopyApplicabilityToRequirements = useCallback((index: number) => {
    if (!activeSpecId) return;
    updateSpecification(activeSpecId, (cur) => {
      const entry = (cur.applicability?.[index] as any) ?? null;
      if (!entry) return cur;
      const copied = JSON.parse(JSON.stringify(entry));
      return { ...cur, requirements: [...cur.requirements, copied] };
    });
  }, [activeSpecId, updateSpecification]);

  const handleEditRequirement = useCallback((index: number) => {
    if (!activeSpecification) return;
    const entry = activeSpecification.requirements[index] as any;
    // try to prefill picker from structured rule or sample
    let sampleIdx: number | null = null;
    if (entry && entry.sample) {
      // try to find matching applicability sample index
      const idx = activeSpecification.applicability.findIndex((a: any) => a && a.sourceGlobalId === entry.sourceGlobalId);
      sampleIdx = idx >= 0 ? idx : null;
    }
    editingRequirementIndexRef.current = index;
    setPickerSampleIndex(sampleIdx);
    // populate availablePsets from either the sample or the entry.sample
    const sampleObj = entry?.sample ?? (sampleIdx != null ? (activeSpecification.applicability?.[sampleIdx] as any)?.sample : null);
    const psets = sampleObj ? extractPropertySetsFromSample(sampleObj) : {};
    setAvailablePsets(psets);
    // if structured rule exists, parse propertyPath
    if (entry && entry.propertyPath) {
      const [pset, prop] = String(entry.propertyPath).split('.');
      setPickerPset(pset ?? Object.keys(psets)[0] ?? null);
      setPickerProperty(prop ?? (pset ? (psets[pset]?.[0] ?? null) : (Object.values(psets)[0]?.[0] ?? null)));
      setRuleOperator(entry.operator ?? 'equals');
      setRuleValue(entry.value ?? '');
    } else {
      setPickerPset(Object.keys(psets)[0] ?? null);
      setPickerProperty(Object.keys(psets)[0] ? (psets[Object.keys(psets)[0]][0] ?? null) : null);
      setRuleOperator('equals');
      setRuleValue('');
    }
    setPickerOpen(true);
  }, [activeSpecification]);

  const handleRemoveRequirement = useCallback((index: number) => {
    if (!activeSpecId) return;
    updateSpecification(activeSpecId, (cur) => {
      const next = [...cur.requirements];
      next.splice(index, 1);
      return { ...cur, requirements: next };
    });
  }, [activeSpecId, updateSpecification]);

  const handleSaveIds = useCallback(() => {
    try {
      const xmlString = generateIdsXml(specifications);
      const blob = new Blob([xmlString], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.endsWith('.ids') ? fileName : `${fileName}.ids`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to generate or save IDS file:', error);
      alert('Error: Could not save IDS file. See console for details.');
    }
  }, [specifications, fileName]);

  const handleValidate = useCallback(() => {
    if (!onValidate) return;
    if (specifications.length === 0) {
      alert('Please add at least one specification before validating.');
      return;
    }
    try {
      const xmlString = generateIdsXml(specifications);
      onValidate(xmlString);
    } catch (error) {
      console.error('Failed to generate IDS XML for validation:', error);
      alert('Error: Could not generate IDS XML. See console for details.');
    }
  }, [specifications, onValidate]);

  const handleLoadIds = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xmlString = e.target?.result as string;
        const parsedSpecs = parseIds(xmlString);
        setSpecifications(parsedSpecs);
        setActiveSpecId(parsedSpecs[0]?.id || null);
      } catch (error) {
        console.error('Failed to parse IDS file:', error);
        alert('Error: Could not parse IDS file. Ensure it is a valid .ids XML file.');
      }
    };
    reader.readAsText(file);
    // Reset input value to allow loading the same file again
    event.target.value = '';
  }, []);

  if (!isOpen) return null;

  return (
    <Draggable nodeRef={panelNodeRef} handle=".ids-creator-header" bounds="parent">
      <Paper
        ref={panelNodeRef}
        elevation={8}
        sx={{
          position: 'fixed',
          top: 140,
          left: 40,
          width: 900,
          height: isMinimized ? 'auto' : 600,
          minWidth: 400,
          minHeight: isMinimized ? 56 : 300,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1850,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <Box
          className="ids-creator-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            backgroundColor: 'primary.main',
            color: 'white',
            cursor: 'move',
            gap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ whiteSpace: 'nowrap' }}>IDS Creator:</Typography>
            <TextField
              value={fileName.replace(/\.ids$/, '')}
              onChange={(e) => setFileName(e.target.value)}
              variant="outlined"
              size="small"
              placeholder="filename"
              sx={{
                flex: 1,
                maxWidth: 300,
                '& .MuiOutlinedInput-root': {
                  color: 'white',
                  '& fieldset': {
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                  },
                  '&:hover fieldset': {
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'rgba(255, 255, 255, 0.7)',
                  },
                },
                '& .MuiInputBase-input': {
                  py: 0.75,
                },
              }}
            />
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>.ids</Typography>
          </Box>
          <Box>
            {/* Add Load, Save, and Validate buttons */}
            <input ref={fileInputRef} type="file" accept=".ids, .xml" style={{ display: 'none' }} onChange={handleLoadIds} />
            <IconButton size="small" color="inherit" title="Load IDS File" onClick={() => fileInputRef.current?.click()}>
              <FileOpenIcon />
            </IconButton>
            <IconButton size="small" color="inherit" title="Save IDS File" onClick={handleSaveIds}>
              <SaveIcon />
            </IconButton>
            {onValidate && (
              <IconButton 
                size="small" 
                color="inherit" 
                title="Validate in IDS Checker" 
                onClick={handleValidate}
                disabled={specifications.length === 0}
              >
                <PlayArrowIcon />
              </IconButton>
            )}
            <IconButton 
              size="small" 
              color="inherit" 
              onClick={() => setIsMinimized((p) => !p)}
              title={isMinimized ? "Expand panel" : "Minimize panel"}
            >
              {isMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
            </IconButton>
            <IconButton 
              size="small" 
              color="inherit" 
              onClick={onClose}
              title="Close IDS Creator"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>

        {!isMinimized && (
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Panel 1: Specification Navigator */}
            <Box sx={{ width: 250, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Button startIcon={<AddIcon />} fullWidth variant="outlined" onClick={handleAddSpecification}>
                  Add Specification
                </Button>
              </Box>
              <List sx={{ overflowY: 'auto', flex: 1 }}>
                {specifications.map((spec) => (
                  <ListItem
                    key={spec.id}
                    disablePadding
                    secondaryAction={
                      <IconButton
                        edge="end"
                        size="small"
                        title="Delete specification"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeSpecification(spec.id);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemButton selected={spec.id === activeSpecId} onClick={() => setActiveSpecId(spec.id)}>
                      <ListItemText primary={spec.name} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Box>

            {/* Panel 2: Rule Editor */}
            <Box sx={{ flex: 1, p: 2, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {activeSpecification ? (
                <>
                  <TextField
                    label="Specification Name"
                    value={activeSpecification.name}
                    onChange={handleRenameActiveSpecification}
                    variant="outlined"
                    size="small"
                  />
                  <Divider />
                  <Typography variant="h6">Applicability (Which elements?)</Typography>
                  <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      Capture one or more example elements from the viewer to describe what this specification applies to.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleCaptureSelection('applicability')}
                        disabled={!selectedItemSnapshot}
                      >
                        Use current selection
                      </Button>
                      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                        {selectedItemSnapshot ? 'Current viewer selection will be stored as a template.' : 'Select an element to enable capture.'}
                      </Typography>
                    </Box>
                    {activeSpecification.applicability.length ? (
                      <List dense sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, maxHeight: 160, overflowY: 'auto' }}>
                        {activeSpecification.applicability.map((entry, index) => {
                          const item = entry as any;
                          const label = item?.ifcClass ? `${item.ifcClass} (${item.sourceGlobalId || 'unknown'})` : item?.sourceGlobalId || 'Captured element';
                          const captured = item?.capturedAt ? new Date(item.capturedAt).toLocaleString() : '';
                          return (
                            <ListItem
                              key={`${item?.sourceGlobalId || 'entry'}-${index}`}
                              secondaryAction={
                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                  <IconButton size="small" title="Copy to requirements" onClick={() => handleCopyApplicabilityToRequirements(index)}>
                                    <ContentCopyIcon fontSize="small" />
                                  </IconButton>
                                  <IconButton
                                    edge="end"
                                    size="small"
                                    title="Remove captured applicability"
                                    onClick={() => handleRemoveCapturedEntry('applicability', index)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                              }
                            >
                              <ListItemText primary={getSampleLabel(item)} secondary={captured ? `Captured ${captured}` : undefined} />
                            </ListItem>
                          );
                        })}
                      </List>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No applicability examples captured yet.
                      </Typography>
                    )}
                  </Box>
                  <Divider />
                  <Typography variant="h6">Requirements (What must be true?)</Typography>
                  <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      Capture the same or other elements to store property snapshots you want to enforce as requirements.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleCaptureSelection('requirements')}
                        disabled={!selectedItemSnapshot}
                      >
                        Use current selection
                      </Button>
                      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                        {selectedItemSnapshot ? 'Snapshot will be added to requirements.' : 'Select an element to enable capture.'}
                      </Typography>
                    </Box>
                    {activeSpecification.requirements.length ? (
                      <List dense sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, maxHeight: 160, overflowY: 'auto' }}>
                        {activeSpecification.requirements.map((entry, index) => {
                          const item = entry as any;
                          const label = getSampleLabel(item);
                          const captured = item?.capturedAt ? new Date(item.capturedAt).toLocaleString() : '';
                          return (
                            <ListItem key={`${item?.id || item?.sourceGlobalId || 'req'}-${index}`}>
                              <ListItemText
                                primary={item.propertyPath ? `${item.propertyPath} ${item.operator ? `(${item.operator})` : ''}` : label}
                                secondary={item.propertyPath ? `Expected: ${item.value ?? '(any)'}${captured ? ` — captured ${captured}` : ''}` : (captured ? `Captured ${captured}` : undefined)}
                              />
                              <ListItemSecondaryAction>
                                <IconButton size="small" title="Edit requirement" onClick={() => handleEditRequirement(index)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                                <IconButton size="small" title="Remove requirement" onClick={() => handleRemoveRequirement(index)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </ListItemSecondaryAction>
                            </ListItem>
                          );
                        })}
                      </List>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No requirement snapshots captured yet.
                      </Typography>
                    )}
                  </Box>
                </>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <Typography color="text.secondary">Load or create a specification to begin.</Typography>
                </Box>
              )}
            </Box>

            {/* Panel 3: Model Inspector */}
            <Box sx={{ width: 300, borderLeft: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2">
                  Property Sets
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedItemProperties.length > 0 ? `${selectedItemProperties.length} properties` : 'Select an element'}
                </Typography>
              </Box>
              {selectedItemProperties.length > 0 ? (
                <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {selectedItemProperties.map((prop, index) => (
                      <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                          {prop.label}
                        </Typography>
                        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                          {prop.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              ) : selectedItemData ? (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    No property sets found for this element.
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Select an element in the viewer to inspect its property sets.
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}
        {/* Property picker dialog */}
        <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{editingRequirementIndexRef.current != null ? 'Edit Requirement' : 'Create Requirement'}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel id="pset-label">Property Set</InputLabel>
                <Select
                  labelId="pset-label"
                  value={pickerPset ?? ''}
                  label="Property Set"
                  onChange={(e) => setPickerPset(String(e.target.value) || null)}
                >
                  {Object.keys(availablePsets).length ? (
                    Object.keys(availablePsets).map((ps) => <MenuItem key={ps} value={ps}>{ps}</MenuItem>)
                  ) : (
                    <MenuItem value="">(none)</MenuItem>
                  )}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="prop-label">Property</InputLabel>
                <Select
                  labelId="prop-label"
                  value={pickerProperty ?? ''}
                  label="Property"
                  onChange={(e) => setPickerProperty(String(e.target.value) || null)}
                >
                  {(pickerPset && availablePsets[pickerPset]) ? (
                    availablePsets[pickerPset].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)
                  ) : (
                    <MenuItem value="">(none)</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
              <FormControl fullWidth>
                <InputLabel id="op-label">Operator</InputLabel>
                <Select labelId="op-label" value={ruleOperator} label="Operator" onChange={(e) => setRuleOperator(String(e.target.value))}>
                  <MenuItem value="exists">exists</MenuItem>
                  <MenuItem value="equals">equals</MenuItem>
                  <MenuItem value="not-equals">not equals</MenuItem>
                  <MenuItem value="contains">contains</MenuItem>
                  <MenuItem value="matches">matches (regex)</MenuItem>
                </Select>
              </FormControl>
              <TextField fullWidth label="Value (optional)" value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setPickerOpen(false); editingRequirementIndexRef.current = null; }}>Cancel</Button>
            <Button variant="contained" onClick={createRequirementRuleFromPicker} startIcon={<SaveAsIcon />}>{editingRequirementIndexRef.current != null ? 'Save' : 'Create'}</Button>
          </DialogActions>
        </Dialog>
      </Paper>
    </Draggable>
  );
};

export default IdsCreatorPanel;
