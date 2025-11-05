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
import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import type { ViewerApi, RequirementOperator, ItemData } from '../ids/ids.types';

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
  
  // Category filter
  const [selectedIfcTypes, setSelectedIfcTypes] = useState<string[]>([]);
  const [availableIfcTypes] = useState<string[]>([
    'IfcWall', 'IfcDoor', 'IfcWindow', 'IfcColumn', 'IfcBeam', 'IfcSlab', 
    'IfcRoof', 'IfcStair', 'IfcCurtainWall', 'IfcDuct', 'IfcPipe', 'IfcSpace'
  ]);
  
  // Property discovery
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [discoveringProperties, setDiscoveringProperties] = useState(false);
  
  // Filter application mode
  const [filterMode, setFilterMode] = useState<'isolate' | 'color' | 'both'>('isolate');
  const [filterActive, setFilterActive] = useState(false);
  
  // Filtering state
  const [filtering, setFiltering] = useState(false);
  const [filterProgress, setFilterProgress] = useState<{ current: number; total: number } | null>(null);
  const [resultIds, setResultIds] = useState<string[]>([]);
  
  // Reset on close
  useEffect(() => {
    if (!open) {
      setField(DEFAULT_FIELD);
      setOperator('equals');
      setValue('');
      setFilterActive(false);
      setResultIds([]);
    }
  }, [open]);
  
  // Extract GlobalId from item data
  const extractGlobalId = (item: ItemData): string | null => {
    if (item.GlobalId && typeof item.GlobalId === 'object' && 'value' in item.GlobalId) {
      return item.GlobalId.value;
    }
    if (typeof item.GlobalId === 'string') {
      return item.GlobalId;
    }
    // Fallback: search for guid/_guid
    for (const key of Object.keys(item)) {
      if (/guid|globalid/i.test(key)) {
        const val = (item as any)[key];
        if (typeof val === 'string') return val;
        if (val && typeof val === 'object' && 'value' in val) return val.value;
      }
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
  
  // Test if value matches operator
  const testOperator = (actual: any, operator: RequirementOperator, expected: string): boolean => {
    if (operator === 'exists') {
      return actual != null && String(actual).trim() !== '';
    }
    
    if (actual == null) return false;
    
    const actualStr = String(actual);
    
    switch (operator) {
      case 'equals':
        return actualStr === expected;
      case 'not-equals':
        return actualStr !== expected;
      case 'contains':
        return actualStr.toLowerCase().includes(expected.toLowerCase());
      case 'matches':
        try {
          return new RegExp(expected, 'i').test(actualStr);
        } catch {
          return false;
        }
      case 'greater-than':
        return Number(actualStr) > Number(expected);
      case 'less-than':
        return Number(actualStr) < Number(expected);
      default:
        return false;
    }
  };
  
  // Flatten object to dot-notation paths
  const flattenPropertyPaths = (obj: any, prefix = '', maxDepth = 4, currentDepth = 0): string[] => {
    const paths: string[] = [];
    
    if (currentDepth >= maxDepth || obj == null || typeof obj !== 'object') {
      return paths;
    }
    
    // Unwrap .value if present
    if ('value' in obj && Object.keys(obj).length === 1) {
      obj = obj.value;
      if (obj == null || typeof obj !== 'object') {
        return paths;
      }
    }
    
    for (const key of Object.keys(obj)) {
      if (key === '_localId' || key === '_category') continue; // Skip internal fields
      
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const val = obj[key];
      
      // If it has a .value, it's a terminal property
      if (val && typeof val === 'object' && 'value' in val && Object.keys(val).length === 1) {
        paths.push(fullPath);
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
      const config = {
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
    if (open && viewerApi) {
      discoverProperties();
    }
  }, [open, viewerApi, selectedIfcTypes, discoverProperties]);
  
  // Apply filter handler - on-demand loading
  const handleApplyFilter = useCallback(async () => {
    if (!viewerApi || !viewerApi.getItemsByCategory || !viewerApi.getItemsData) {
      alert('⚠️ On-demand loading not supported by this viewer API');
      return;
    }
    
    setFiltering(true);
    setFilterProgress(null);
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
      const config = field.includes('Pset_') || field.includes('.') 
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
  
  // Apply filter to view (isolate/color)
  useEffect(() => {
    let mounted = true;
    const applyToView = async () => {
      if (!viewerApi || !resultIds || resultIds.length === 0 || filtering) return;
      
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
    
    if (resultIds && resultIds.length > 0 && !filtering) {
      applyToView();
    }
    
    return () => { mounted = false; };
  }, [resultIds, viewerApi, filterMode, filtering]);
  
  // Clear filter handler
  const handleClearFilter = useCallback(async () => {
    if (!viewerApi) return;
    
    try {
      await viewerApi.clearIsolation();
      await viewerApi.clearColors();
      setFilterActive(false);
      setResultIds([]);
    } catch (error) {
      console.warn('Failed to clear filter', error);
    }
  }, [viewerApi]);
  
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Parametric Filter (On-Demand)</DialogTitle>
      <DialogContent>
            
        {/* Category Filter Section */}
        <Box sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
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
        
        {/* Filter Definition Section */}
        <Box sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            2. Define Filter
          </Typography>
          
          <Autocomplete
            fullWidth
            size="small"
            freeSolo
            options={availableProperties}
            value={field}
            onChange={(_, newValue) => setField(newValue || '')}
            onInputChange={(_, newValue) => setField(newValue)}
            loading={discoveringProperties}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Property Path"
                placeholder="e.g. Name, Pset_WallCommon.FireRating"
                helperText={
                  discoveringProperties 
                    ? "Discovering properties..." 
                    : `${availableProperties.length} properties available`
                }
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
            groupBy={(option) => {
              // Group by top-level prefix (e.g., "Pset_", "Qto_", or property name)
              if (option.includes('.')) {
                const prefix = option.split('.')[0];
                if (prefix.startsWith('Pset_')) return '📊 Property Sets';
                if (prefix.startsWith('Qto_')) return '📏 Quantities';
                return '🔗 Related Properties';
              }
              return '⚡ Direct Properties';
            }}
            sx={{ mb: 1 }}
          />
          
          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel>Operator</InputLabel>
            <Select value={operator} onChange={(e) => setOperator(e.target.value as RequirementOperator)}>
              {OPERATORS.map((op) => (
                <MenuItem key={op} value={op}>
                  {op}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          
          {operator !== 'exists' && (
            <TextField
              fullWidth
              size="small"
              label="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter value to match"
            />
          )}
          
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" gutterBottom display="block">
              Filter Mode:
            </Typography>
            <ToggleButtonGroup
              value={filterMode}
              exclusive
              onChange={(_, newMode) => newMode && setFilterMode(newMode)}
              size="small"
              fullWidth
            >
              <ToggleButton value="isolate">Isolate</ToggleButton>
              <ToggleButton value="color">Color</ToggleButton>
              <ToggleButton value="both">Both</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>
        
        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={handleApplyFilter}
            disabled={filtering || !viewerApi || (operator !== 'exists' && !value.trim())}
          >
            {filtering ? 'Filtering...' : 'Apply Filter'}
          </Button>
          
          {filterActive && (
            <Button
              fullWidth
              variant="outlined"
              onClick={handleClearFilter}
              disabled={filtering}
            >
              Clear Filter
            </Button>
          )}
        </Box>
        
        {/* Progress */}
        {filtering && filterProgress && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Processing: {filterProgress.current.toLocaleString()} / {filterProgress.total.toLocaleString()}
            </Typography>
            <LinearProgress 
              variant="determinate" 
              value={(filterProgress.current / filterProgress.total) * 100} 
            />
          </Box>
        )}
        
        {/* Results */}
        {filterActive && resultIds.length > 0 && (
          <Alert severity="success" sx={{ mt: 2 }}>
            <strong>Filter Active:</strong> {resultIds.length.toLocaleString()} elements match
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
