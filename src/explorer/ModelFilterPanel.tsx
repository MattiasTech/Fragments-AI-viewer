import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import Tooltip from '@mui/material/Tooltip';
import Draggable from 'react-draggable';
import type { ViewerApi, RequirementOperator } from '../ids/ids.types';
import { v4 as uuidv4 } from 'uuid';

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

interface FilterRule {
    id: string;
    property: string | null;
    operator: RequirementOperator;
    values: string[];
}

interface ModelFilterPanelProps {
  open: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
}

export default function ModelFilterPanel({ open, onClose, viewerApi }: ModelFilterPanelProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  // Persistence Load
  const savedState = useMemo(() => {
    try {
      const s = localStorage.getItem('savora_filter_state_v1');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }, []);

  const [isMinimized, setIsMinimized] = useState<boolean>(savedState?.isMinimized ?? false);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number }>(savedState?.size || { width: 450, height: 600 });
  
  // Resize Refs
  const resizingRef = useRef(false);
  const resizeOriginRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);

  const onResizePointerMove = useCallback((event: PointerEvent) => {
    if (!resizingRef.current) return;
    const origin = resizeOriginRef.current;
    if (!origin) return;
    const deltaX = event.clientX - origin.startX;
    const deltaY = event.clientY - origin.startY;
    const minWidth = 300;
    const minHeight = 200;
    
    setPanelSize(prev => {
        const nextWidth = Math.max(minWidth, origin.width + deltaX);
        const nextHeight = Math.max(minHeight, origin.height + deltaY);
        // Constrain to viewport ideally, but let's stick to simple logic first
        if (nextWidth === prev.width && nextHeight === prev.height) return prev;
        return { width: Math.round(nextWidth), height: Math.round(nextHeight) };
    });
  }, []);

  const stopResize = useCallback(() => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    resizeOriginRef.current = null;
    window.removeEventListener('pointermove', onResizePointerMove);
    window.removeEventListener('pointerup', stopResize);
  }, [onResizePointerMove]);

  const handleResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent drag
    const node = nodeRef.current;
    if (!node) return;
    resizingRef.current = true;
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    window.addEventListener('pointermove', onResizePointerMove);
    window.addEventListener('pointerup', stopResize);
  }, [onResizePointerMove, stopResize]);

  // --- Filter State ---
  
  // 1. Scope (Multi-Category)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(savedState?.selectedCategories || []);
  const [availableCategories, setAvailableCategories] = useState<string[]>(KNOWN_IFC_TYPES);
  const [checkingCategories, setCheckingCategories] = useState(false);

  // 2. Rules (Layers)
  const [rules, setRules] = useState<FilterRule[]>(savedState?.rules || []);
  
  // Cache for valid properties across selected categories
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);

  // Cache for values per rule (keyed by rule ID)
  // Logic: When rule.property changes, we fetch values.
  const [ruleValuesCache, setRuleValuesCache] = useState<Record<string, string[]>>(savedState?.ruleValuesCache || {});
  const [loadingRuleById, setLoadingRuleById] = useState<string | null>(null);

  // 4. Execution
  const [filterMode, setFilterMode] = useState<'isolate' | 'ghost'>(savedState?.filterMode || 'ghost');

  // Persistence Save
  useEffect(() => {
      const toSave = { isMinimized, selectedCategories, rules, ruleValuesCache, filterMode, size: panelSize };
      localStorage.setItem('savora_filter_state_v1', JSON.stringify(toSave));
  }, [isMinimized, selectedCategories, rules, ruleValuesCache, filterMode, panelSize]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [filterStats, setFilterStats] = useState<{ found: number; total: number } | null>(null);
  
  // --- Helpers ---

  const extractValue = useCallback((prop: any): any => {
    if (prop == null) return null;
    const val = (prop && typeof prop === 'object' && 'value' in prop) ? prop.value : prop;
    if (val == null) return null;
    if (typeof val !== 'object') return val;

    if ('NominalValue' in val) return extractValue(val.NominalValue);
    if ('nominalValue' in val) return extractValue(val.nominalValue);
    if ('Value' in val) return extractValue(val.Value);
    
    for (const key of ['Label', 'Name', 'Description', 'StringValue', 'BooleanValue', 'IntegerValue', 'RealValue']) {
       if (key in val) return extractValue(val[key]);
    }

    const keys = Object.keys(val);
    if (keys.length === 1 && typeof val[keys[0]] !== 'object') {
       return val[keys[0]];
    }
    return JSON.stringify(val);
  }, []);

  const getNestedValue = useCallback((item: any, path: string): any => {
    if (!path) return undefined;
    
    // Explicit expressID check
    if (path === 'expressID') return item.expressID;

    if (!path.includes('.')) {
      // Robust access: Direct -> Attributes -> Case Insensitive
      let val = item[path];
      if (val === undefined && item.attributes) val = item.attributes[path];
      
      // Case insensitive fallback
      if (val === undefined) {
          const lower = path.toLowerCase();
          const attrKey = item.attributes ? Object.keys(item.attributes).find(k => k.toLowerCase() === lower) : undefined;
          if (attrKey && item.attributes) val = item.attributes[attrKey];
          
          if (val === undefined) {
             const itemKey = Object.keys(item).find(k => k.toLowerCase() === lower);
             if (itemKey) val = item[itemKey];
          }
      }
      return extractValue(val);
    }

    const [psetName, propName] = path.split('.');
    
    // Look in IsDefinedBy
    const definitions = item.IsDefinedBy || item.isDefinedBy;
    if (Array.isArray(definitions)) {
      for (const def of definitions) {
        const pset = def.RelatingPropertyDefinition ?? def; 
        const currentPsetName = extractValue(pset.Name);
        
        if (currentPsetName === psetName) {
          const props = pset.HasProperties || pset.hasProperties;
          if (Array.isArray(props)) {
             for (const prop of props) {
                if (extractValue(prop.Name) === propName) {
                    return extractValue(prop);
                }
             }
          }
        }
      }
    }
    
    // Also check "psets" dictionary if available
    if (item.psets && item.psets[psetName] && item.psets[psetName][propName]) {
        return extractValue(item.psets[psetName][propName]);
    }

    return undefined;
  }, [extractValue]);

  // --- Discovery Effects ---

  // 1. Scan Model for Categories
  const handleScanCategories = async () => {
    if (!viewerApi) return;
    setCheckingCategories(true);
    try {
      if (viewerApi.getLoadedCategories) {
        // Fast path: use index data if available
        const found = await viewerApi.getLoadedCategories();
        if (found && found.length > 0) {
           setAvailableCategories(found);
           if (selectedCategories.length === 0) setSelectedCategories([found[0]]);
           return; 
        }
      }

      // Fallback: Check KNOWN types
      if (!viewerApi.getItemsByCategory) return;
      
      const found: string[] = [];
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
      if (found.length > 0 && selectedCategories.length === 0) setSelectedCategories([found[0]]);
    } catch (e) {
      console.error(e);
      setAvailableCategories(KNOWN_IFC_TYPES);
    } finally {
      setCheckingCategories(false);
    }
  };

  // 2. Scan Properties (When Categories Change)
  useEffect(() => {
    if (selectedCategories.length === 0 || !open || !viewerApi) return;
    let active = true;
    
    const discover = async () => {
      if (!viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
      setLoadingProperties(true);
      try {
        const propSet = new Set<string>();
        ['Name', 'GlobalId', 'Tag', 'Description', 'ObjectType', 'expressID'].forEach(p => propSet.add(p));
        
        // Scan a few items from EACH selected category
        const regexes = selectedCategories.map(c => new RegExp(`^${c}$`, 'i'));
        const map = await viewerApi.getItemsByCategory(regexes);
        
        // For each model...
        for (const [modelId, ids] of Object.entries(map)) {
            // Limit to 10 items total to keep it fast
            const sampleIds = ids.slice(0, 10);
            if (sampleIds.length === 0) continue;

             const config = {
                attributesDefault: true,
                relations: { IsDefinedBy: { attributes: true, relations: true } }
             };

             const items = await viewerApi.getItemsDataByModel(modelId, sampleIds, config);
             
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
        }

        if (active) setAvailableProperties(Array.from(propSet).sort());
      } catch (e) {
        console.error("Prop discovery failed", e);
      } finally {
        if (active) setLoadingProperties(false);
      }
    };
    
    discover();
    return () => { active = false; };
  }, [selectedCategories, open, viewerApi, extractValue]);

  // 3. Helper: Check if item matches a rule (Reusable)
  const isRuleMatch = useCallback((item: any, rule: FilterRule) => {
    if (!rule.property) return true; // Skip incomplete
    
    // Check if rule is "complete" enough to filter
    if (rule.operator !== 'exists' && rule.values.length === 0) return true; // Treat empty values as pass (or ignore rule)

    const itemVal = getNestedValue(item, rule.property);
    const sVal = String(itemVal ?? '').trim().toLowerCase();
    
    if (rule.operator === 'exists') {
        const exists = itemVal != null && sVal !== '';
        return exists;
    }

    // Determine target set conditions
    // Operator 'not-equals' with multiple values usually means "Not Equal to A AND Not Equal to B" (Exclude set)
    // Operator 'equals' with multiple values usually means "Equal to A OR Equal to B" (Include set)
    const isExclusion = rule.operator === 'not-equals';
    
    // For exclusion, we assume MATCH if it matches NONE of the targets (Default True, fail on match)
    // For inclusion, we assume MATCH if it matches ANY of the targets (Default False, pass on match)
    let finalMatch = isExclusion; 

    for (const targetRaw of rule.values) {
        const target = targetRaw.trim().toLowerCase();
        let currentValMatch = false;

        // Boolean Logic (Handle strict boolean types and strings like "True"/"False")
        if (typeof itemVal === 'boolean') {
             const lowerT = target.toLowerCase();
             const isFalse = lowerT === 'false' || lowerT === '0' || lowerT === 'no';
             const isTrue = lowerT === 'true' || lowerT === '1' || lowerT === 'yes';
             
             let boolTarget: boolean | null = null;
             if (isFalse) boolTarget = false;
             else if (isTrue) boolTarget = true;
             
             if (boolTarget !== null) {
                  currentValMatch = (itemVal === boolTarget);
             } else {
                  // Fallback: compare string representation
                  currentValMatch = (sVal === target);
             }
        } else {
            // String / Number Logic
            switch (rule.operator) {
                // For exclusion, we check EQUALITY inside the loop, then negate result outside if needed?
                // Actually, let's just check "Is this specific value a match for the condition?"
                // But "not-equals" is tricky with OR logic. 
                // Let's standardise: Determine "Is Equal?" first.
                case 'equals': 
                case 'not-equals':
                     currentValMatch = (sVal === target); 
                     break;
                case 'contains': 
                     currentValMatch = sVal.includes(target); 
                     break;
                case 'matches': 
                     try { currentValMatch = new RegExp(target, 'i').test(sVal); } catch(e) { currentValMatch = false; }
                     break;
                case 'greater-than': 
                     currentValMatch = Number(itemVal) > Number(targetRaw); 
                     break;
                case 'less-than': 
                     currentValMatch = Number(itemVal) < Number(targetRaw); 
                     break;
            }
        }

        if (isExclusion) {
            // If operator is NOT-EQUALS:
            // We want item to be NOT A AND NOT B.
            // If currentValMatch is TRUE (it IS A), then we Fail.
            if (currentValMatch) {
                finalMatch = false;
                break; // Failed exclusion
            }
        } else {
             // Standard OR logic (Equals, Contains, etc)
             // If matches A OR matches B...
             if (currentValMatch) {
                finalMatch = true;
                break; // Found match
             }
        }
    }
    
    return finalMatch;
  }, [getNestedValue]);

  // 4. Scan Values (Called when a Rule's Property changes)
  // Now supports Cascading: filters items by precedingRules before collecting values
  const scanValuesForRule = async (ruleId: string, property: string, precedingRules: FilterRule[] = []) => {
    if (!property || selectedCategories.length === 0 || !viewerApi) return;
    if (!viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
    
    setLoadingRuleById(ruleId);
    try {
        const regexes = selectedCategories.map(c => new RegExp(`^${c}$`, 'i'));
        const map = await viewerApi.getItemsByCategory(regexes);
        const valSet = new Set<string>();

        // Determine if we need complex relation fetching based on ANY active rule
        // (Preceding rules might use complex props too)
        let needsComplex = property.includes('.');
        precedingRules.forEach(r => { if (r.property && r.property.includes('.')) needsComplex = true; });

        for (const [modelId, ids] of Object.entries(map)) {
             // Cascading: We must sample enough items to survive the previous filters
             // Increased sample size 50 -> 300
             const sampleIds = ids.slice(0, 300);
             if (sampleIds.length === 0) continue;

             const config = needsComplex 
                ? { 
                    attributesDefault: true,
                    relations: { IsDefinedBy: { attributes: true, relations: true } } 
                  }
                : { 
                    attributesDefault: true,
                    attributes: ['GlobalId'] 
                  };

             const items = await viewerApi.getItemsDataByModel(modelId, sampleIds, config);

             for (const item of items) {
                // Cascading Check: Must pass all preceding rules
                if (!precedingRules.every(r => isRuleMatch(item, r))) {
                    continue;
                }

                // If passed, collect value
                const val = getNestedValue(item, property);
                if (val != null) {
                    if (typeof val === 'number') valSet.add(val.toString());
                    else if (typeof val === 'string' && val.trim() !== '') valSet.add(val);
                    else if (typeof val === 'boolean') valSet.add(val ? 'True' : 'False');
                }
             }
        }

        setRuleValuesCache(prev => ({
            ...prev,
            [ruleId]: Array.from(valSet).sort()
        }));

    } catch(e) {
        console.warn(e);
    } finally {
        setLoadingRuleById(null);
    }
  };


  // --- Logic : Rule Management ---
  const addRule = () => {
    const newRule: FilterRule = {
        id: uuidv4(),
        property: null,
        operator: 'equals',
        values: []
    };
    setRules([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    setRules(prev => {
        const idx = prev.findIndex(r => r.id === id);
        const nextRules = prev.filter(r => r.id !== id);
        
        if (idx !== -1) {
            // Rules after the removed one need re-scanning (constraints removed)
            // They are now at indices [idx, idx+1, ...] in `nextRules`
            for (let i = idx; i < nextRules.length; i++) {
                const r = nextRules[i];
                if (r.property) {
                    const preceding = nextRules.slice(0, i);
                    scanValuesForRule(r.id, r.property, preceding);
                }
            }
        }
        return nextRules;
    });

    // Clean cache
    setRuleValuesCache(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
    });
  };

  const updateRule = (id: string, updates: Partial<FilterRule>) => {
    setRules(prev => {
        const nextRules = prev.map(r => {
            if (r.id !== id) return r;
            const updated = { ...r, ...updates };
            // If property changed, clear values
            if (updates.property !== undefined && updates.property !== r.property) {
                 updated.values = []; 
            }
            return updated;
        });

        const idx = nextRules.findIndex(r => r.id === id);
        if (idx !== -1) {
            const rule = nextRules[idx];
            const oldRule = prev[idx];

            // 1. Scan SELF if property changed
            if (updates.property !== undefined && updates.property !== oldRule.property) {
                if (rule.property) {
                     const preceding = nextRules.slice(0, idx);
                     scanValuesForRule(id, rule.property, preceding);
                }
            }

            // 2. Scan SUBSEQUENT if filtering logic changed
            const filteringChanged = 
                updates.property !== undefined || 
                updates.operator !== undefined ||
                updates.values !== undefined;
            
            if (filteringChanged) {
                for (let i = idx + 1; i < nextRules.length; i++) {
                    const sub = nextRules[i];
                    if (sub.property) {
                        const subPreceding = nextRules.slice(0, i);
                        scanValuesForRule(sub.id, sub.property, subPreceding);
                    }
                }
            }
        }
        return nextRules;
    });
  };

  // --- Apply ---
  const handleApply = async () => {
    if (!viewerApi || !viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) return;
    // Must select at least one category
    if (selectedCategories.length === 0) {
        alert("Please select at least one category.");
        return;
    }

    setIsFiltering(true);
    setFilterStats(null);
    
    try {
        const regexes = selectedCategories.map(c => new RegExp(`^${c}$`, 'i'));
        const categoryMap = await viewerApi.getItemsByCategory(regexes);
        
        let total = 0;
        let matches: string[] = [];
        
        // Optimization: Determine which properties we need to fetch
        // GlobalId + defaults are always fetched. If rules use deep properties, note them.
        // Actually, the new robust fix uses `attributesDefault: true` + IsDefinedBy relations if needed.
        
        // We'll figure out config once per model? No, config depends on if ANY rule needs complex props.
        let needsComplex = false;
        rules.forEach(r => { if (r.property && r.property.includes('.')) needsComplex = true; });

        // Robust Config: fetch defaults (Tag/Name) AND relations (Properties) if needed
        const config = needsComplex
            ? { 
                attributesDefault: true,
                relations: { IsDefinedBy: { attributes: true, relations: true } } 
              }
            : { 
                attributesDefault: true,
                attributes: ['GlobalId'] 
              };

        for (const [modelId, ids] of Object.entries(categoryMap)) {
            total += ids.length;
            
            // If no rules, we just match everything in category
            if (rules.length === 0) {
                 const items = await viewerApi.getItemsDataByModel(modelId, ids, config);
                 for (const item of items) {
                    let gId = extractValue(item.GlobalId) || extractValue(item._guid);
                    if (!gId && item.attributes) {
                         gId = extractValue(item.attributes.GlobalId) || extractValue(item.attributes.GlobalID);
                    }
                    if (gId) matches.push(gId);
                 }
                 continue;
            }
            
            // Fetch items
            const items = await viewerApi.getItemsDataByModel(modelId, ids, config);
            
            for (const item of items) {
                // Robust GlobalId extraction
                let gId = extractValue(item.GlobalId) || extractValue(item._guid);
                if (!gId && item.attributes) {
                     gId = extractValue(item.attributes.GlobalId) || extractValue(item.attributes.GlobalID);
                }
                if (!gId) continue;

                // CHECK RULES (AND Logic)
                let itemPassesAll = true;
                
                for (const rule of rules) {
                    if (!isRuleMatch(item, rule)) {
                        itemPassesAll = false;
                        break;
                    }
                }
                
                if (itemPassesAll) matches.push(gId);
            }
        }
        
        setFilterStats({ found: matches.length, total });
        
        // Apply Mode
        if (viewerApi.clearIsolation) await viewerApi.clearIsolation();
        if (viewerApi.clearColors) await viewerApi.clearColors();

        if (matches.length > 0) {
            if (filterMode === 'isolate') await viewerApi.isolate(matches);
            else if (viewerApi.ghost) await viewerApi.ghost(matches);
            else await viewerApi.color(matches, { r: 0.9, g: 0.9, b: 0.9, a: 0.5 }); // fallback ghost
            
            if (viewerApi.fitViewTo) await viewerApi.fitViewTo(matches);
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
    if (viewerApi.clearIsolation) await viewerApi.clearIsolation();
    if (viewerApi.clearColors) await viewerApi.clearColors();
    setFilterStats(null);
  };

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
          width: panelSize.width,
          height: isMinimized ? 'auto' : panelSize.height,
          minWidth: 300,
          minHeight: isMinimized ? 50 : 200,
          maxWidth: '90vw',
          maxHeight: '85vh',
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
            <IconButton size="small" color="inherit" onClick={() => setIsMinimized(!isMinimized)}>
              {isMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
            </IconButton>
            <IconButton size="small" color="inherit" onClick={onClose}><CloseIcon /></IconButton>
          </Box>
        </Box>
        
        {/* Content */}
        {!isMinimized && (
          <Box sx={{ p: 2, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            
            {/* 1. Category (Multi) */}
            <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle2" color="primary">1. Categories (Scope)</Typography>
                    <Box>
                        <Tooltip 
                            PopperProps={{ sx: { zIndex: 2100 } }}
                            title={
                                <Box sx={{ p: 0.5 }}>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5 }}>Parametric Filter Guide</Typography>
                                    <Typography variant="caption" display="block">• Select <b>Categories</b> to define scope.</Typography>
                                    <Typography variant="caption" display="block">• Add <b>Rules</b> to filter by properties.</Typography>
                                    <Typography variant="caption" display="block">• Multiple rules are combined (AND).</Typography>
                                    <Typography variant="caption" display="block">• Dropdown values depend on previous rules.</Typography>
                                </Box>
                            } 
                            arrow 
                            placement="left"
                        >
                            <IconButton size="small" sx={{ mr: 1, color: 'text.secondary' }}>
                                <HelpOutlineIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <IconButton onClick={handleScanCategories} size="small" disabled={checkingCategories}>
                            <Tooltip title="Scan Model"><RefreshIcon fontSize="small" /></Tooltip>
                        </IconButton>
                    </Box>
                </Box>
                
                <Autocomplete
                    multiple
                    size="small"
                    options={availableCategories}
                    value={selectedCategories}
                    onChange={(_, v) => setSelectedCategories(v)}
                    disableCloseOnSelect
                    disabled={checkingCategories}
                    renderOption={(props, option, { selected }) => (
                        <li {...props}>
                            <Checkbox style={{ marginRight: 8 }} checked={selected} />
                            {option}
                        </li>
                    )}
                    renderInput={(params) => (
                        <TextField 
                            {...params} 
                            placeholder={selectedCategories.length === 0 ? "Select Categories..." : ""}
                            helperText={selectedCategories.length === 0 ? "Select at least one category" : `${selectedCategories.length} selected`}
                        />
                    )}
                    renderTags={(value, getTagProps) => 
                        value.slice(0, 2).map((option, index) => (
                            <Chip label={option} size="small" {...getTagProps({ index })} />
                        ))
                    }
                    componentsProps={{
                        popper: { style: { zIndex: 9999 } }
                    }}
                />
                {selectedCategories.length > 2 && (
                    <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                        (+ {selectedCategories.length - 2} more)
                    </Typography>
                )}
            </Box>

            <Divider />

            {/* 2. Rules List */}
            <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                     <Typography variant="subtitle2" color="primary">2. Property Rules</Typography>
                     <Button startIcon={<AddIcon />} size="small" onClick={addRule}>
                        Add Rule
                     </Button>
                </Box>
                
                {rules.length === 0 && (
                    <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                        No property filters applied.<br/>All elements in matching categories will be shown.
                    </Typography>
                )}

                <Box display="flex" flexDirection="column" gap={2}>
                    {rules.map((rule, idx) => (
                        <Paper key={rule.id} variant="outlined" sx={{ p: 1.5, position: 'relative', bgcolor: 'grey.50' }}>
                            <IconButton 
                                size="small" 
                                onClick={() => removeRule(rule.id)}
                                sx={{ position: 'absolute', top: 2, right: 2 }}
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>

                            <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
                                Rule #{idx + 1} (AND)
                            </Typography>

                            <Box display="flex" flexDirection="column" gap={1.5}>
                                {/* Property */}
                                <Autocomplete
                                    size="small"
                                    options={availableProperties}
                                    value={rule.property}
                                    onChange={(_, v) => updateRule(rule.id, { property: v })}
                                    disabled={selectedCategories.length === 0 || loadingProperties}
                                    freeSolo
                                    groupBy={(option) => option.includes('.') ? 'Property Sets' : 'Attributes'}
                                    renderInput={(params) => (
                                        <TextField 
                                            {...params} 
                                            label="Property" 
                                            placeholder="Choose property..."
                                        />
                                    )}
                                    componentsProps={{ popper: { style: { zIndex: 9999 } } }}
                                />

                                <Box display="flex" gap={1}>
                                    {/* Operator */}
                                    <FormControl size="small" sx={{ minWidth: 100 }}>
                                        <InputLabel>Operator</InputLabel>
                                        <Select 
                                            value={rule.operator} 
                                            label="Operator" 
                                            onChange={(e) => updateRule(rule.id, { operator: e.target.value as RequirementOperator })}
                                            MenuProps={{ style: { zIndex: 9999 } }}
                                        >
                                            {OPERATORS.map(op => <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>)}
                                        </Select>
                                    </FormControl>

                                    {/* Values (Multi) */}
                                    <Autocomplete
                                        fullWidth
                                        multiple
                                        size="small"
                                        freeSolo
                                        options={ruleValuesCache[rule.id] || []}
                                        value={rule.values}
                                        onChange={(_, v) => updateRule(rule.id, { values: v })}
                                        disabled={!rule.property || rule.operator === 'exists'}
                                        loading={loadingRuleById === rule.id}
                                        disableCloseOnSelect
                                        limitTags={2}
                                        renderOption={(props, option, { selected }) => (
                                            <li {...props}>
                                                <Checkbox style={{ marginRight: 8 }} checked={selected} />
                                                {option}
                                            </li>
                                        )}
                                        renderInput={(params) => (
                                            <TextField 
                                                {...params} 
                                                label="Values (OR)"
                                                placeholder={rule.operator === 'exists' ? "N/A" : "Select values..."}
                                                InputProps={{
                                                    ...params.InputProps,
                                                    endAdornment: (
                                                        <>
                                                        {loadingRuleById === rule.id ? <CircularProgress color="inherit" size={20} /> : null}
                                                        {params.InputProps.endAdornment}
                                                        </>
                                                    )
                                                }}
                                            />
                                        )}
                                        componentsProps={{ popper: { style: { zIndex: 9999 } } }}
                                    />
                                </Box>
                            </Box>
                        </Paper>
                    ))}
                </Box>

            </Box>

            <Divider />

            {/* 4. Controls */}
            <Box>
                <Typography variant="subtitle2" gutterBottom>Display Mode</Typography>
                <ToggleButtonGroup
                    value={filterMode}
                    exclusive
                    onChange={(_, v) => v && setFilterMode(v)}
                    size="small"
                    fullWidth
                    color="primary"
                >
                    <ToggleButton value="ghost">Ghost (Translucent)</ToggleButton>
                    <ToggleButton value="isolate">Isolate (Hide Others)</ToggleButton>
                </ToggleButtonGroup>
            </Box>

             {filterStats && (
                <Alert severity={filterStats.found > 0 ? "success" : "warning"} sx={{ mt: 1 }}>
                    Matched: {filterStats.found} / {filterStats.total}
                </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button 
                    variant="contained" 
                    fullWidth 
                    onClick={handleApply}
                    disabled={isFiltering || selectedCategories.length === 0}
                >
                    {isFiltering ? <CircularProgress size={24} color="inherit" /> : "Apply Filter"}
                </Button>
                <Button 
                    variant="outlined" 
                    onClick={handleClear}
                >
                    Clear
                </Button>
            </Box>

          </Box>
        )}
        <Box
          onPointerDown={handleResizeStart}
          sx={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            width: 16,
            height: 16,
            cursor: 'nwse-resize',
            borderRight: '2px solid',
            borderBottom: '2px solid',
            borderColor: 'divider',
            opacity: 0.6,
            zIndex: 20
          }} 
        />
      </Paper>
    </Draggable>
  );
}
