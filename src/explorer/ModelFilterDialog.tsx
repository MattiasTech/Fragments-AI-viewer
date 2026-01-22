import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import LinearProgress from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { ViewerApi, RequirementOperator, ItemData } from '../ids/ids.types';

type Props = {
  open: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
};

// Comprehensive list of common IFC entities to help discovery
const KNOWN_IFC_TYPES = [
  'IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcRoof', 'IfcWindow', 'IfcDoor', 'IfcColumn', 'IfcBeam',
  'IfcStair', 'IfcStairFlight', 'IfcRailing', 'IfcCurtainWall', 'IfcPlate', 'IfcMember',
  'IfcBuildingElementProxy', 'IfcFurnishingElement', 'IfcFlowTerminal', 'IfcSpace',
  'IfcDuctSegment', 'IfcPipeSegment', 'IfcFlowFitting', 'IfcFlowController', 'IfcDiscreteAccessory'
];

const OPERATORS: { value: RequirementOperator; label: string }[] = [
  { value: 'equals', label: '=' },
  { value: 'not-equals', label: '≠' },
  { value: 'contains', label: 'contains' },
  { value: 'matches', label: 'regex' },
  { value: 'greater-than', label: '>' },
  { value: 'less-than', label: '<' },
  { value: 'exists', label: 'exists' },
];

export default function ModelFilterDialog({ open, onClose, viewerApi }: Props) {
  // --- State ---
  
  // 1. Scope (Category)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [availableCategories, setAvailableCategories] = useState<string[]>(KNOWN_IFC_TYPES);
  const [checkingCategories, setCheckingCategories] = useState(false);

  // 2. Property
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);

  // 3. Rule
  const [operator, setOperator] = useState<RequirementOperator>('equals');
  const [value, setValue] = useState<string>('');
  const [availableValues, setAvailableValues] = useState<string[]>([]); // For current property
  const [loadingValues, setLoadingValues] = useState(false);

  // 4. Execution
  const [filterMode, setFilterMode] = useState<'isolate' | 'color'>('isolate');
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterStats, setFilterStats] = useState<{ found: number; total: number } | null>(null);
  const [filterResult, setFilterResult] = useState<string[]>([]); // GlobalIds

  // --- Reset ---
  useEffect(() => {
    if (!open) {
      // Optional: reset state on close, or keep it to preserve user context
      // setFilterResult([]);
      // setFilterStats(null);
    }
  }, [open]);

  // --- Helpers ---

  // Robust value extractor (handles wrappers, NominalValue, etc.)
  const extractValue = useCallback((prop: any): any => {
    if (prop == null) return null;
    
    // Unwrap standard wrappers
    const val = (prop && typeof prop === 'object' && 'value' in prop) ? prop.value : prop;
    
    if (val == null) return null;
    if (typeof val !== 'object') return val;

    // Handle IFC value types
    if ('NominalValue' in val) return extractValue(val.NominalValue);
    if ('nominalValue' in val) return extractValue(val.nominalValue);
    if ('Value' in val) return extractValue(val.Value);
    
    // Recursive key search for common value holders
    for (const key of ['Label', 'Name', 'Description', 'StringValue', 'BooleanValue', 'IntegerValue', 'RealValue']) {
       if (key in val) return extractValue(val[key]);
    }

    // Single key fallback (e.g. IfcLabel: "my value")
    const keys = Object.keys(val);
    if (keys.length === 1 && typeof val[keys[0]] !== 'object') {
       return val[keys[0]];
    }

    return JSON.stringify(val);
  }, []);

  const getNestedValue = useCallback((item: any, path: string): any => {
    if (!path) return undefined;
    
    // 1. Direct Attributes (e.g. "Name", "GlobalId", "PredefinedType")
    if (!path.includes('.')) {
      return extractValue(item[path] ?? (item.attributes ? item.attributes[path] : undefined));
    }

    // 2. Property Sets (ThatOpen / web-ifc structure)
    // Structure: Item -> IsDefinedBy (Array of RelDefinesByProperties) -> Rel.RelatingPropertyDefinition (PropertySet) -> HasProperties (Array)
    const [psetName, propName] = path.split('.');
    
    // Look in IsDefinedBy
    const definitions = item.IsDefinedBy || item.isDefinedBy;
    if (Array.isArray(definitions)) {
      for (const def of definitions) {
        // Handle both direct PropertySet or wrapper
        const pset = def.RelatingPropertyDefinition ?? def; 
        const currentPsetName = extractValue(pset.Name);
        
        if (currentPsetName === psetName) {
          const props = pset.HasProperties || pset.hasProperties;
          if (Array.isArray(props)) {
             for (const prop of props) {
                if (extractValue(prop.Name) === propName) {
                    return extractValue(prop); // This handles NominalValue etc via extractValue
                }
             }
          }
        }
      }
    }
    
    // Also check "psets" dictionary if the loader created a shortcut
    if (item.psets && item.psets[psetName] && item.psets[psetName][propName]) {
        return extractValue(item.psets[psetName][propName]);
    }

    return undefined;
  }, [extractValue]);

  // --- Actions ---

  // 1. Scan Model for Categories
  const handleScanCategories = async () => {
    if (!viewerApi || !viewerApi.getItemsByCategory) return;
    setCheckingCategories(true);
    try {
      // We can't easily ask "what types exist", so we'll do a quick check on the KNOWN types
      // or if the API supports it, getting all items and checking types.
      // Optimised: Check keys from getItemsByCategory with regex matching all
      // Actually `getItemsByCategory` usually returns map of modelID -> IDs. 
      // It doesn't tell us the category.
      // So we have to iterate the KNOWN types.
      
      const found: string[] = [];
      // Batch checks in parallel
      const chunks = [];
      const chunkSize = 5;
      for (let i = 0; i < KNOWN_IFC_TYPES.length; i += chunkSize) {
        chunks.push(KNOWN_IFC_TYPES.slice(i, i + chunkSize));
      }

      for (const chunk of chunks) {
        const promises = chunk.map(async (type) => {
           if (!viewerApi.getItemsByCategory) return null;
           const res = await viewerApi.getItemsByCategory([new RegExp(`^${type}$`, 'i')]);
           const count = Object.values(res).reduce((acc, ids) => acc + ids.length, 0);
           return count > 0 ? type : null;
        });
        
        const results = await Promise.all(promises);
        found.push(...results.filter((t): t is string => t !== null));
      }
      
      setAvailableCategories(found.sort());
      if (found.length > 0 && !selectedCategory) setSelectedCategory(found[0]);
    } catch (e) {
      console.error(e);
      // Fallback
      setAvailableCategories(KNOWN_IFC_TYPES);
    } finally {
      setCheckingCategories(false);
    }
  };

  // 2. Scan Properties for Category
  useEffect(() => {
    if (!selectedCategory || !open || !viewerApi) return;
    
    let active = true;
    
    const discover = async () => {
      if (!viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
      setLoadingProperties(true);
      try {
        setAvailableValues([]);
        setValue('');
        
        const regex = new RegExp(`^${selectedCategory}$`, 'i');
        const map = await viewerApi.getItemsByCategory([regex]);
        
        // Get a sample
        const modelId = Object.keys(map)[0];
        if (!modelId) {
            setAvailableProperties([]);
            return;
        }
        
        const ids = map[modelId].slice(0, 15); // Sample 15 items
        
        // Request deep data
        const config = {
          attributesDefault: true,
          relations: {
            IsDefinedBy: { attributes: true, relations: true } // Need Psets
          }
        };
        
        const items = await viewerApi.getItemsDataByModel(modelId, ids, config);
        
        const propSet = new Set<string>();
        
        // Add basic attributes
        ['Name', 'GlobalId', 'Tag', 'Description', 'ObjectType'].forEach(p => propSet.add(p));
        
        // Add Psets
        for (const item of items) {
           const definitions = item.IsDefinedBy || item.isDefinedBy;
           if (Array.isArray(definitions)) {
             for (const def of definitions) {
               const pset = def.RelatingPropertyDefinition ?? def;
               const psetName = extractValue(pset.Name);
               if (!psetName) continue;
               
               const props = pset.HasProperties || pset.hasProperties;
               if (Array.isArray(props)) {
                 for (const p of props) {
                   const pName = extractValue(p.Name);
                   if (pName) propSet.add(`${psetName}.${pName}`);
                 }
               }
             }
           }
        }
        
        if (active) {
            setAvailableProperties(Array.from(propSet).sort());
        }
      } catch (e) {
        console.error("Prop discovery failed", e);
      } finally {
        if (active) setLoadingProperties(false);
      }
    };
    
    discover();
    return () => { active = false; };
  }, [selectedCategory, open, viewerApi, extractValue]);

  // 3. Scan Values for Property
  useEffect(() => {
    if (!selectedProperty || !selectedCategory || !open || !viewerApi) return;
    
    let active = true;
    
    const scanValues = async () => {
       if (!viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
       setLoadingValues(true);
       try {
         const regex = new RegExp(`^${selectedCategory}$`, 'i');
         const map = await viewerApi.getItemsByCategory([regex]);
         
         const modelId = Object.keys(map)[0];
         if (!modelId) return;
         
         // Larger sample for values
         const ids = map[modelId].slice(0, 50); 
         
         const config = selectedProperty.includes('.') 
            ? { attributesDefault: false, relations: { IsDefinedBy: { attributes: true, relations: true } } }
            : { attributesDefault: true };
            
         const items = await viewerApi.getItemsDataByModel(modelId, ids, config);
         
         const valSet = new Set<string>();
         
         for (const item of items) {
            const val = getNestedValue(item, selectedProperty);
            if (val != null) {
                // Formatting
                if (typeof val === 'number') valSet.add(val.toString());
                else if (typeof val === 'string' && val.trim() !== '') valSet.add(val);
                else if (typeof val === 'boolean') valSet.add(val ? 'True' : 'False');
            }
         }
         
         if (active) {
            setAvailableValues(Array.from(valSet).sort());
         }
       } catch (e) {
         console.warn(e);
       } finally {
         if (active) setLoadingValues(false);
       }
    };
    
    scanValues();
    return () => { active = false; };
  }, [selectedProperty, selectedCategory, open, viewerApi, getNestedValue]);

  // 4. Apply Filter
  const handleApply = async () => {
    if (!viewerApi || !viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
    setIsFiltering(true);
    setFilterStats(null);
    
    try {
        // Step 1: Get Scope
        const regex = selectedCategory 
            ? new RegExp(`^${selectedCategory}$`, 'i') 
            : /.*/;
            
        const categoryMap = await viewerApi.getItemsByCategory([regex]);
        
        let total = 0;
        let matches: string[] = [];
        
        // Step 2: Check properties
        const hasPropertyCheck = selectedProperty && operator;
        
        for (const [modelId, ids] of Object.entries(categoryMap)) {
            total += ids.length;
            
            if (!hasPropertyCheck) {
                // If only category selected, we need GlobalIds
                // We need to fetch basic data to map ID -> GlobalId
                // Optimization: If ViewerApi supports getting GlobalIDs directly? 
                // We'll fetch min data.
                const config = { attributes: ['GlobalId'] };
                const items = await viewerApi.getItemsDataByModel(modelId, ids, config);
                matches.push(...items.map(i => extractValue(i.GlobalId)).filter(Boolean));
                continue;
            }
            
            // Check property values
            const config = selectedProperty.includes('.')
                ? { attributesDefault: false, attributes: ['GlobalId'], relations: { IsDefinedBy: { attributes: true, relations: true } } }
                : { attributesDefault: true }; // Gets Attributes + GlobalId
                
            // Chunking for performance if massive?
            // For now, assume < 5000 items is fine.
            const items = await viewerApi.getItemsDataByModel(modelId, ids, config);
            
            for (const item of items) {
                const itemVal = getNestedValue(item, selectedProperty);
                const gId = extractValue(item.GlobalId);
                
                if (!gId) continue;
                
                // Compare
                let matched = false;
                const sVal = String(itemVal ?? ''); // Convert to string for comparison
                const target = value.toLowerCase();
                const actual = sVal.toLowerCase();
                
                switch (operator) {
                    case 'exists': matched = itemVal != null && sVal !== ''; break;
                    case 'equals': matched = actual === target; break;
                    case 'not-equals': matched = actual !== target; break;
                    case 'contains': matched = actual.includes(target); break;
                    case 'greater-than': matched = Number(itemVal) > Number(value); break;
                    case 'less-than': matched = Number(itemVal) < Number(value); break;
                }
                
                if (matched) matches.push(gId);
            }
        }
        
        setFilterResult(matches);
        setFilterStats({ found: matches.length, total });
        
        // Visualization
        if (matches.length > 0) {
            if (filterMode === 'isolate') await viewerApi.isolate(matches);
            else await viewerApi.color(matches, { r: 1, g: 0.8, b: 0.2, a: 1 });
            
            // Fit view if manageable
            if (viewerApi.fitViewTo) await viewerApi.fitViewTo(matches);
        } else {
             // Show empty state?
        }
        
    } catch (e) {
        console.error(e);
        alert("Filter failed: " + e);
    } finally {
        setIsFiltering(false);
    }
  };

  const handleClear = async () => {
    if (!viewerApi) return;
    await viewerApi.clearIsolation();
    await viewerApi.clearColors();
    setFilterResult([]);
    setFilterStats(null);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ borderBottom: '1px solid #eee' }}>
         <Box display="flex" justifyContent="space-between" alignItems="center">
            Parametric Filter (Model Scanner)
            <Box>
                <IconButton onClick={handleScanCategories} size="small" disabled={checkingCategories}>
                    <Tooltip title="Re-scan model for categories"><RefreshIcon /></Tooltip>
                </IconButton>
            </Box>
         </Box>
      </DialogTitle>
      
      <DialogContent sx={{ pt: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        
        {/* SECTION 1: CATEGORY */}
        <Box>
            <Typography variant="subtitle2" color="primary" gutterBottom>1. Select Category</Typography>
            <Autocomplete
                options={availableCategories}
                value={selectedCategory}
                onChange={(_, v) => setSelectedCategory(v)}
                disabled={checkingCategories}
                renderInput={(params) => (
                    <TextField 
                        {...params} 
                        label={checkingCategories ? "Scanning model..." : "IFC Category"} 
                        helperText="Start here based on model contents"
                    />
                )}
            />
        </Box>
        
        {/* SECTION 2: PROPERTY */}
        <Box>
            <Typography variant="subtitle2" color="primary" gutterBottom>2. Select Property (Optional)</Typography>
            <Autocomplete
                options={availableProperties}
                value={selectedProperty}
                onChange={(_, v) => { setSelectedProperty(v); setAvailableValues([]); setValue(''); }}
                disabled={!selectedCategory || loadingProperties}
                loading={loadingProperties}
                freeSolo
                groupBy={(option) => option.includes('.') ? 'Property Sets' : 'Attributes'}
                renderInput={(params) => (
                    <TextField 
                        {...params} 
                        label="Property Name" 
                        placeholder={selectedCategory ? "Choose property..." : "Select category first"}
                        InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                                <>
                                {loadingProperties ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                                </>
                            )
                        }}
                    />
                )}
            />
        </Box>
        
        {/* SECTION 3: RULE */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
             <FormControl sx={{ minWidth: 120 }}>
                <InputLabel>Operator</InputLabel>
                <Select value={operator} label="Operator" onChange={(e) => setOperator(e.target.value as RequirementOperator)}>
                    {OPERATORS.map(op => <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>)}
                </Select>
             </FormControl>
             
             <Autocomplete
                fullWidth
                freeSolo
                options={availableValues}
                value={value}
                onChange={(_, v) => setValue(v || '')}
                onInputChange={(_, v) => setValue(v)}
                disabled={!selectedProperty || operator === 'exists'}
                loading={loadingValues}
                renderInput={(params) => (
                    <TextField 
                         {...params}
                         label="Value"
                         placeholder={loadingValues ? "Scanning values..." : "Enter or select value"}
                    />
                )}
             />
        </Box>
        
        {/* SECTION 4: ACTIONS */}
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
             <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="body2" sx={{ alignSelf: 'center' }}>Action Mode:</Typography>
                <ToggleButtonGroup 
                    value={filterMode} 
                    exclusive 
                    onChange={(_, v) => v && setFilterMode(v)}
                    size="small"
                >
                    <ToggleButton value="isolate">Isolate</ToggleButton>
                    <ToggleButton value="color">Highlight</ToggleButton>
                </ToggleButtonGroup>
             </Box>
             
             {filterStats && (
                 <Alert severity={filterStats.found > 0 ? "success" : "warning"} sx={{ mb: 2 }}>
                    Found {filterStats.found} elements (out of {filterStats.total} within category)
                 </Alert>
             )}
             
             <Box sx={{ display: 'flex', gap: 1 }}>
                <Button 
                    variant="contained" 
                    fullWidth 
                    onClick={handleApply}
                    disabled={isFiltering || !selectedCategory}
                >
                    {isFiltering ? "Processing..." : "Apply Filter"}
                </Button>
                <Button variant="outlined" color="inherit" onClick={handleClear} disabled={isFiltering}>
                    Reset
                </Button>
             </Box>
             {isFiltering && <LinearProgress sx={{ mt: 1 }} />}
        </Box>
        
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}