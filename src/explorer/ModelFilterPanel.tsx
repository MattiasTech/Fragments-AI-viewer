import React, { useCallback, useEffect, useState, useRef } from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import ClearIcon from '@mui/icons-material/Clear';
import Draggable from 'react-draggable';
import type { ViewerApi, RequirementOperator, ItemData, ItemsDataConfig } from '../ids/ids.types';

const DEFAULT_FIELD = 'GlobalId';

const OPERATORS: RequirementOperator[] = [
  'equals',
  'contains',
  'matches',
  'greater-than',
  'less-than',
  'not-equals',
];

const DEFAULT_IFC_TYPES = [
  'IfcWall',
  'IfcColumn',
  'IfcBeam',
  'IfcSlab',
  'IfcDoor',
  'IfcWindow',
  'IfcStair',
  'IfcRoof',
  'IfcSpace',
];

interface ModelFilterPanelProps {
  open: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
}

export default function ModelFilterPanel({ open, onClose, viewerApi }: ModelFilterPanelProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  
  // UI State
  const [isMinimized, setIsMinimized] = useState(false);
  
  // Filter Configuration
  const [selectedIfcTypes, setSelectedIfcTypes] = useState<string[]>([]);
  const [field, setField] = useState(DEFAULT_FIELD);
  const [operator, setOperator] = useState<RequirementOperator>('equals');
  const [value, setValue] = useState('');
  const [filterMode, setFilterMode] = useState<'ghost' | 'isolate'>('ghost');
  
  // Property Discovery
  const [availableIfcTypes] = useState(DEFAULT_IFC_TYPES);
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [discoveringProperties, setDiscoveringProperties] = useState(false);
  
  // Filter State
  const [filtering, setFiltering] = useState(false);
  const [filterProgress, setFilterProgress] = useState<{ current: number; total: number } | null>(null);
  const [filterActive, setFilterActive] = useState(false);
  const [resultIds, setResultIds] = useState<string[] | null>(null);
  const [resultSummary, setResultSummary] = useState<string>('');
  
  // Extract GlobalId from item data
  const extractGlobalId = (item: ItemData): string | null => {
    if (item.GlobalId && typeof item.GlobalId === 'object' && 'value' in item.GlobalId) {
      return item.GlobalId.value as string;
    }
    if (item._guid && typeof item._guid === 'object' && 'value' in item._guid) {
      return item._guid.value as string;
    }
    return null;
  };
  
  // Extract value from nested property path (ThatOpen pattern)
  const getValueByPath = (item: ItemData, path: string): any => {
    const unwrap = (obj: any): any => {
      if (obj && typeof obj === 'object' && 'value' in obj) {
        return obj.value;
      }
      return obj;
    };
    
    const parts = path.split('.');
    
    // Direct property access (e.g., "Name", "Description")
    if (parts.length === 1) {
      const value = unwrap((item as any)[parts[0]]);
      return value;
    }
    
    // Property set path (e.g., "NV_PSteel.NV_STATUS")
    // Following ThatOpen example: IsDefinedBy is an array at item level
    const [psetName, propName] = parts;
    
    const isDefinedBy = (item as any).IsDefinedBy;
    if (!Array.isArray(isDefinedBy)) return undefined;
    
    // Find the property set
    for (const pset of isDefinedBy) {
      if (unwrap(pset.Name) !== psetName) continue;
      
      // HasProperties is also an array
      const hasProperties = pset.HasProperties;
      if (!Array.isArray(hasProperties)) continue;
      
      // Find the property
      for (const prop of hasProperties) {
        if (unwrap(prop.Name) !== propName) continue;
        
        // Return NominalValue (standard IFC property value field)
        return unwrap(prop.NominalValue);
      }
    }
    
    return undefined;
  };
  
  // Test operator conditions
  const testOperator = (actualValue: any, op: RequirementOperator, expectedValue: string): boolean => {
    if (actualValue == null) return false;
    
    const actualStr = String(actualValue);
    const expectedStr = String(expectedValue);
    
    switch (op) {
      case 'equals':
        return actualStr === expectedStr;
      case 'not-equals':
        return actualStr !== expectedStr;
      case 'contains':
        return actualStr.toLowerCase().includes(expectedStr.toLowerCase());
      case 'matches':
        try {
          return new RegExp(expectedStr).test(actualStr);
        } catch {
          return false;
        }
      case 'greater-than':
        return parseFloat(actualStr) > parseFloat(expectedStr);
      case 'less-than':
        return parseFloat(actualStr) < parseFloat(expectedStr);
      default:
        return false;
    }
  };
  
  // Flatten nested property paths for discovery
  const flattenPropertyPaths = (obj: any, prefix = '', maxDepth = 3, currentDepth = 0): string[] => {
    if (currentDepth >= maxDepth) return [];
    
    const paths: string[] = [];
    
    for (const key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      if (key.startsWith('_')) continue; // Skip internal fields
      
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const val = obj[key];
      
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        // Recurse into first array element
        paths.push(...flattenPropertyPaths(val[0], fullPath, maxDepth, currentDepth + 1));
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        // Recurse into nested objects
        paths.push(...flattenPropertyPaths(val, fullPath, maxDepth, currentDepth + 1));
      } else if (val != null && typeof val !== 'function') {
        // Terminal value
        paths.push(fullPath);
      }
    }
    
    return paths;
  };
  
  // Discover available properties from sample elements
  const discoverProperties = useCallback(async () => {
    if (!viewerApi || !viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
    
    setDiscoveringProperties(true);
    
    try {
      // Get sample elements from selected categories (or all if none selected)
      const regexes = selectedIfcTypes.length > 0
        ? selectedIfcTypes.map(t => new RegExp(`^${t}$`, 'i'))
        : [/.*/];
      
      const categoryMap = await viewerApi.getItemsByCategory(regexes);
      
      // Take up to 10 sample elements from the first model
      const [modelId, localIds] = Object.entries(categoryMap)[0] || [null, []];
      if (!modelId || localIds.length === 0) {
        setAvailableProperties([]);
        return;
      }
      
      const sampleSize = Math.min(10, localIds.length);
      const sampleIds = localIds.slice(0, sampleSize);
      
      // Fetch with full relations using the ViewerApi method (ThatOpen pattern)
      const config: ItemsDataConfig = {
        attributesDefault: false,
        attributes: ["Name", "NominalValue", "GlobalId"],
        relations: {
          IsDefinedBy: { attributes: true, relations: true },
          IsTypedBy: { attributes: true, relations: false },
          HasAssignments: { attributes: true, relations: false },
        }
      };
      
      const sampleData = await viewerApi.getItemsDataByModel(modelId, sampleIds, config);
      
      // Collect all unique property paths
      const pathSet = new Set<string>();
      for (const item of sampleData) {
        const paths = flattenPropertyPaths(item);
        paths.forEach(p => {
          // Strip "IsDefinedBy." prefix for cleaner display
          // Users don't need to know about IFC relation structure
          const cleanPath = p.startsWith('IsDefinedBy.') ? p.substring('IsDefinedBy.'.length) : p;
          pathSet.add(cleanPath);
        });
      }
      
      // Sort and filter
      const sortedPaths = Array.from(pathSet)
        .filter(p => !p.startsWith('_')) // Remove internal fields
        .sort();
      
      setAvailableProperties(sortedPaths);
      
    } catch (error: any) {
      console.error('Property discovery failed:', error);
    } finally {
      setDiscoveringProperties(false);
    }
  }, [viewerApi, selectedIfcTypes]);
  
  // Auto-discover properties when dialog opens or category changes
  useEffect(() => {
    if (open && !isMinimized) {
      discoverProperties();
    }
  }, [open, selectedIfcTypes, discoverProperties, isMinimized]);
  
  // Apply filter
  const handleApplyFilter = useCallback(async () => {
    if (!viewerApi || !viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) {
      alert('❌ Viewer API not ready');
      return;
    }
    
    if (!field || !value) {
      alert('⚠️ Please select a property and enter a value');
      return;
    }
    
    setFiltering(true);
    setFilterProgress({ current: 0, total: 1 });
    const matchingGlobalIds: string[] = [];
    
    try {
      // Step 1: Get items by category (fast - no property loading)
      let categoryMap: Record<string, number[]>;
      
      if (selectedIfcTypes.length > 0) {
        // Filter by selected categories
        const regexes = selectedIfcTypes.map(t => new RegExp(`^${t}$`, 'i'));
        categoryMap = await viewerApi.getItemsByCategory(regexes);
      } else {
        // Get all items
        categoryMap = await viewerApi.getItemsByCategory([/.*/]);
      }
      
      // Count total items
      const totalItems = Object.values(categoryMap).reduce((sum, ids) => sum + ids.length, 0);
      
      if (totalItems === 0) {
        alert('⚠️ No elements found matching the category filter');
        setFiltering(false);
        return;
      }
      
      // Step 2: Load properties on-demand and filter (only filtered elements!)
      let processed = 0;
      
      // Configure what relations to load (ThatOpen pattern)
      const config: ItemsDataConfig = field.includes('Pset_') || field.includes('.') 
        ? {
            attributesDefault: false,
            attributes: ["Name", "NominalValue", "GlobalId"],
            relations: {
              IsDefinedBy: { attributes: true, relations: true },
              IsTypedBy: { attributes: true, relations: false },
            }
          }
        : {
            attributesDefault: false,
            attributes: ["Name", "GlobalId"],
          };
      
      // Process each model's filtered elements
      for (const [modelId, localIds] of Object.entries(categoryMap)) {
        if (localIds.length === 0) continue;
        
        
        // Use ViewerApi method to get items data
        if (!viewerApi.getItemsDataByModel) {
          console.error('getItemsDataByModel not available');
          continue;
        }
        
        // Fetch data for just these local IDs
        const itemsData = await viewerApi.getItemsDataByModel(modelId, localIds, config);
        
        // Filter and collect matching GlobalIds
        let debugCount = 0;
        for (const item of itemsData) {
          const globalId = extractGlobalId(item);
          if (!globalId) continue;
          
          // Test the filter condition
          const actualValue = getValueByPath(item, field);
          
          if (testOperator(actualValue, operator, value)) {
            matchingGlobalIds.push(globalId);
          }
          
          processed++;
          if (processed % 100 === 0) {
            setFilterProgress({ current: processed, total: totalItems });
          }
        }
      }
      
      setResultIds(matchingGlobalIds);
      setResultSummary(`${matchingGlobalIds.length} of ${totalItems} elements`);
      
      if (matchingGlobalIds.length === 0) {
        alert('ℹ️ No elements matched the filter criteria');
      } else if (matchingGlobalIds.length === totalItems) {
        alert(`✅ All ${totalItems} elements matched the filter!\n\nTip: Try a different value or use "not equals" operator to see some elements filtered out.`);
      }
      
    } catch (error: any) {
      console.error('Filter failed:', error);
      alert(`❌ Filter failed: ${error.message}`);
    } finally {
      setFiltering(false);
      setFilterProgress(null);
    }
  }, [viewerApi, field, operator, value, selectedIfcTypes]);
  
  // Apply filter to view (ghost or isolate mode)
  useEffect(() => {
    let mounted = true;
    const applyToView = async () => {
      if (!viewerApi || !resultIds || resultIds.length === 0 || filtering) return;
      
      try {
        
        // Clear previous colors and isolation
        if (viewerApi.clearColors) {
          await viewerApi.clearColors();
        }
        if (viewerApi.clearIsolation) {
          await viewerApi.clearIsolation();
        }
        
        // Apply the selected mode
        if (filterMode === 'ghost') {
          // Ghost mode: make non-matching elements transparent
          if (typeof viewerApi.ghost === 'function') {
            await viewerApi.ghost(resultIds);
          } else {
            console.warn('Ghost mode not supported by viewer API');
          }
        } else {
          // Isolate mode: hide non-matching elements
          await viewerApi.isolate(resultIds);
        }
        
        // Fit view to matching elements
        if (typeof viewerApi.fitViewTo === 'function') {
          await viewerApi.fitViewTo(resultIds);
        }
        
        if (mounted) {
          setFilterActive(true);
        }
      } catch (error) {
        console.error('[Filter] Failed to apply filter to view:', error);
      }
    };
    
    if (resultIds && resultIds.length > 0 && !filtering) {
      applyToView();
    }
    
    return () => { mounted = false; };
  }, [resultIds, viewerApi, filterMode, filtering, selectedIfcTypes]);
  
  // Clear filter handler
  const handleClearFilter = useCallback(async () => {
    if (!viewerApi) return;
    
    try {
      // Clear isolation (unhide all elements)
      if (viewerApi.clearIsolation) {
        await viewerApi.clearIsolation();
      }
      
      // Clear colors
      if (viewerApi.clearColors) {
        await viewerApi.clearColors();
      }
      
      setFilterActive(false);
      setResultIds([]);
      setResultSummary('');
    } catch (error) {
      console.error('❌ [Filter] Failed to clear filter:', error);
    }
  }, [viewerApi]);
  
  if (!open) return null;
  
  return (
    <Draggable nodeRef={nodeRef} handle=".filter-header" bounds="parent">
      <Paper
        ref={nodeRef}
        elevation={8}
        sx={{
          position: 'fixed',
          top: 120,
          left: 30,
          width: 420,
          maxHeight: isMinimized ? 'auto' : '80vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1800,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <Box
          className="filter-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            backgroundColor: 'primary.main',
            color: 'white',
            cursor: 'move'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FilterAltIcon />
            <Typography variant="subtitle1">Parametric Filter</Typography>
          </Box>
          <Box>
            <IconButton 
              size="small" 
              color="inherit" 
              onClick={() => setIsMinimized(!isMinimized)}
              title={isMinimized ? "Expand panel" : "Minimize panel"}
            >
              {isMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
            </IconButton>
            <IconButton size="small" color="inherit" onClick={onClose} title="Close">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
        
        {/* Content */}
        {!isMinimized && (
          <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
            {/* Result Summary */}
            {filterActive && resultSummary && (
              <Alert severity="success" sx={{ mb: 2 }}>
                <strong>Active Filter:</strong> {resultSummary} match
              </Alert>
            )}
            
            {/* Category Filter Section */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                1. Category Filter (Optional)
              </Typography>
              
              <FormControl size="small" fullWidth>
                <InputLabel>IFC Types</InputLabel>
                <Select
                  multiple
                  value={selectedIfcTypes}
                  onChange={(e) => setSelectedIfcTypes(typeof e.target.value === 'string' ? [] : e.target.value as string[])}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(selected as string[]).length === 0 ? (
                        <em>All types</em>
                      ) : (
                        (selected as string[]).map((value) => (
                          <Chip key={value} label={value} size="small" />
                        ))
                      )}
                    </Box>
                  )}
                  MenuProps={{
                    style: { zIndex: 1900 }
                  }}
                >
                  {availableIfcTypes.map((type) => (
                    <MenuItem key={type} value={type}>
                      <Checkbox checked={selectedIfcTypes.indexOf(type) > -1} />
                      <ListItemText primary={type} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            
            <Divider sx={{ my: 2 }} />
            
            {/* Filter Definition Section */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                2. Define Filter
              </Typography>
              
              <Autocomplete
                fullWidth
                size="small"
                value={field}
                onChange={(_, newValue) => setField(newValue || DEFAULT_FIELD)}
                onInputChange={(_, newValue) => setField(newValue || DEFAULT_FIELD)}
                options={availableProperties}
                freeSolo
                loading={discoveringProperties}
                componentsProps={{
                  popper: {
                    style: { zIndex: 1900 }
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Property Path"
                    helperText="e.g., NV_PSteel.NV_STATUS or Pset_WallCommon.FireRating"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {discoveringProperties ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                sx={{ mb: 2 }}
              />
              
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Operator</InputLabel>
                  <Select
                    value={operator}
                    onChange={(e) => setOperator(e.target.value as RequirementOperator)}
                    label="Operator"
                    MenuProps={{
                      style: { zIndex: 1900 }
                    }}
                  >
                    {OPERATORS.map((op) => (
                      <MenuItem key={op} value={op}>{op}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                <TextField
                  size="small"
                  fullWidth
                  label="Value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Enter value..."
                />
              </Box>
              
              {/* Filter Mode Toggle */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" gutterBottom sx={{ display: 'block' }}>
                  Filter Mode:
                </Typography>
                <ToggleButtonGroup
                  value={filterMode}
                  exclusive
                  onChange={(_, newMode) => {
                    if (newMode !== null) {
                      setFilterMode(newMode);
                    }
                  }}
                  size="small"
                  fullWidth
                >
                  <ToggleButton value="ghost">
                    Ghost (Transparent)
                  </ToggleButton>
                  <ToggleButton value="isolate">
                    Isolate (Hide)
                  </ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {filterMode === 'ghost' 
                    ? 'Makes non-matching elements transparent' 
                    : 'Hides non-matching elements completely'}
                </Typography>
              </Box>
            </Box>
            
            <Divider sx={{ my: 2 }} />
            
            {/* Progress */}
            {filtering && filterProgress && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Filtering: {filterProgress.current} / {filterProgress.total}
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={(filterProgress.current / filterProgress.total) * 100} 
                />
              </Box>
            )}
            
            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                onClick={handleApplyFilter}
                disabled={filtering || !field || !value}
                startIcon={filtering ? <CircularProgress size={20} /> : <FilterAltIcon />}
                fullWidth
              >
                {filtering ? 'Filtering...' : 'Apply Filter'}
              </Button>
              
              {filterActive && (
                <Button
                  variant="outlined"
                  onClick={handleClearFilter}
                  startIcon={<ClearIcon />}
                >
                  Clear
                </Button>
              )}
            </Box>
          </Box>
        )}
      </Paper>
    </Draggable>
  );
}
