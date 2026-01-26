import React, { useState, useEffect, useMemo, useRef } from 'react';
import Draggable from 'react-draggable';
import { CostDatabaseManager } from './CostDatabaseManager';
import { CostItem, IfcToWbsMapping } from './types';
import { loadMappings } from './mapping.store';
import MappingConfigDialog from './MappingConfigDialog';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Collapse from '@mui/material/Collapse';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CalculateIcon from '@mui/icons-material/Calculate';
import SettingsIcon from '@mui/icons-material/Settings';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import * as XLSX from 'exceljs';
import type { ViewerApi } from '../ids/ids.types';

interface QtoPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  viewerApi?: ViewerApi | null;
}

interface QuantityItem {
  elementId: string;
  ifcClass: string;
  description: string;
  quantity: number;
  unit: string;
  matchedCostItem?: CostItem;
  materialCost?: number;
  laborCost?: number;
  totalCost?: number;
}

interface GroupedQuantity {
  wbsCode: string;
  description: string;
  unit: string;
  elementCount: number;
  totalQuantity: number;
  materialCost: number;
  laborCost: number;
  totalCost: number;
  items: QuantityItem[];
}

export const QtoPanel: React.FC<QtoPanelProps> = ({ isOpen = true, onClose, viewerApi }) => {
  const [costData, setCostData] = useState<CostItem[]>([]);
  const [quantities, setQuantities] = useState<QuantityItem[]>([]);
  const [groupedQuantities, setGroupedQuantities] = useState<GroupedQuantity[]>([]);
  const [mappings, setMappings] = useState<IfcToWbsMapping[]>([]);
  const [activeTab, setActiveTab] = useState<'database' | 'quantities'>('database');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState({ current: 0, total: 0, message: '' });
  const [isMappingDialogOpen, setIsMappingDialogOpen] = useState(false);
  const [showGrouped, setShowGrouped] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const dbManager = useMemo(() => new CostDatabaseManager(), []);
  const [isConnected, setIsConnected] = useState(dbManager.isConnected());
  const [isMinimized, setIsMinimized] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);

  // Resizing state
  const [size, setSize] = useState({ width: 800, height: 600 });
  const resizingRef = useRef(false);
  const resizeOriginRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);

  const onResizePointerMove = React.useCallback((event: PointerEvent) => {
    if (!resizingRef.current || !resizeOriginRef.current) return;
    const origin = resizeOriginRef.current;
    
    // Calculate new dimensions
    const deltaX = event.clientX - origin.startX;
    const deltaY = event.clientY - origin.startY;
    
    // Apply constraints (min 400x300 for QTO)
    const nextWidth = Math.max(400, origin.width + deltaX);
    const nextHeight = Math.max(300, origin.height + deltaY);
    
    setSize({ width: Math.round(nextWidth), height: Math.round(nextHeight) });
  }, []);

  const stopResize = React.useCallback(() => {
    resizingRef.current = false;
    resizeOriginRef.current = null;
    window.removeEventListener('pointermove', onResizePointerMove);
    window.removeEventListener('pointerup', stopResize);
    document.body.style.cursor = '';
  }, [onResizePointerMove]);

  const handleResizeStart = React.useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Find the Paper element
    const node = nodeRef.current;
    if (!node) return;
    
    resizingRef.current = true;
    resizeOriginRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: node.offsetWidth,
      height: node.offsetHeight
    };
    
    document.body.style.cursor = 'nwse-resize';
    window.addEventListener('pointermove', onResizePointerMove);
    window.addEventListener('pointerup', stopResize);
  }, [onResizePointerMove, stopResize]);

  // Cleanup resize listeners
  useEffect(() => {
    return () => {
      stopResize();
    };
  }, [stopResize]);

  useEffect(() => {
    dbManager.initialize((data) => {
      setCostData(data as CostItem[]);
      setIsConnected(dbManager.isConnected());
    });
  }, [dbManager]);

  // Load mappings on mount
  useEffect(() => {
    if (isOpen) {
      loadMappings().then(setMappings);
    }
  }, [isOpen]);

  // Cleanup on unmount to prevent viewer errors
  useEffect(() => {
    return () => {
      // Clear any ongoing extraction operations
      setIsExtracting(false);
      // Clear quantities to free memory
      setQuantities([]);
      setGroupedQuantities([]);
    };
  }, []);

  const handleConnect = async () => {
    await dbManager.connectToFile();
    setIsConnected(dbManager.isConnected());
  };

  const handleCreateTemplate = async () => {
    try {
      // Create a new workbook with template data
      const workbook = new XLSX.Workbook();
      const worksheet = workbook.addWorksheet('CostData');

      // Define columns
      worksheet.columns = [
        { header: 'wbsCode', key: 'wbsCode', width: 15 },
        { header: 'description', key: 'description', width: 30 },
        { header: 'unit', key: 'unit', width: 10 },
        { header: 'materialCost', key: 'materialCost', width: 15 },
        { header: 'laborCost', key: 'laborCost', width: 15 },
        { header: 'laborHours', key: 'laborHours', width: 15 }
      ];

      // Add sample data for different disciplines
      const templateData = [
        // MEP - Electrical
        { wbsCode: '1.1.1', description: 'Cable Tray Installation', unit: 'm', materialCost: 45.5, laborCost: 65, laborHours: 0.5 },
        { wbsCode: '1.1.2', description: 'Conduit Installation', unit: 'm', materialCost: 12.3, laborCost: 65, laborHours: 0.3 },
        { wbsCode: '1.1.3', description: 'Light Fixture Installation', unit: 'pcs', materialCost: 120, laborCost: 65, laborHours: 1.2 },
        
        // MEP - HVAC
        { wbsCode: '1.2.1', description: 'Ductwork Installation', unit: 'm2', materialCost: 85, laborCost: 70, laborHours: 2.5 },
        { wbsCode: '1.2.2', description: 'VAV Box Installation', unit: 'pcs', materialCost: 850, laborCost: 70, laborHours: 4 },
        { wbsCode: '1.2.3', description: 'Diffuser Installation', unit: 'pcs', materialCost: 45, laborCost: 70, laborHours: 0.8 },
        
        // MEP - Plumbing
        { wbsCode: '1.3.1', description: 'Pipe Installation DN50', unit: 'm', materialCost: 35, laborCost: 68, laborHours: 0.6 },
        { wbsCode: '1.3.2', description: 'Pipe Installation DN100', unit: 'm', materialCost: 68, laborCost: 68, laborHours: 1.2 },
        { wbsCode: '1.3.3', description: 'Valve Installation', unit: 'pcs', materialCost: 250, laborCost: 68, laborHours: 1.5 },
        
        // Structural
        { wbsCode: '2.1.1', description: 'Concrete Slab m3', unit: 'm3', materialCost: 450, laborCost: 75, laborHours: 8 },
        { wbsCode: '2.1.2', description: 'Reinforcement kg', unit: 'kg', materialCost: 1.8, laborCost: 75, laborHours: 0.05 },
        { wbsCode: '2.1.3', description: 'Steel Column', unit: 'pcs', materialCost: 2500, laborCost: 80, laborHours: 12 },
        
        // Architecture
        { wbsCode: '3.1.1', description: 'Drywall Partition', unit: 'm2', materialCost: 25, laborCost: 60, laborHours: 1.5 },
        { wbsCode: '3.1.2', description: 'Door Installation', unit: 'pcs', materialCost: 450, laborCost: 60, laborHours: 3 },
        { wbsCode: '3.1.3', description: 'Window Installation', unit: 'pcs', materialCost: 650, laborCost: 60, laborHours: 4 },
        { wbsCode: '3.1.4', description: 'Flooring Tile', unit: 'm2', materialCost: 45, laborCost: 55, laborHours: 1.2 }
      ];

      // Add rows
      worksheet.addRows(templateData);

      // Style the header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };

      // Generate the file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'QTO_CostDatabase_Template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert('Template file downloaded! Open it, save it locally, and then click "Connect to Cost Database" to link it to the QTO module.');
    } catch (error) {
      console.error('Failed to create template:', error);
      alert('Failed to create template file. See console for details.');
    }
  };

  const handleDataChange = (newRow: CostItem, index: number) => {
    const newData = [...costData];
    newData[index] = newRow;
    setCostData(newData);
    dbManager.updateData(newData);
  };

  /**
   * Helper to extract value from ThatOpen's wrapped values
   * Properties in ThatOpen Components might be objects like { value: 'actualValue' }
   */
  const unwrapValue = (val: any): any => {
    if (val && typeof val === 'object' && 'value' in val) {
      return val.value;
    }
    return val;
  };

  /**
   * Extract a property value from element data using a property path
   * Supports paths like "Length", "attributes.Length", "Qto_ColumnBaseQuantities.Length"
   */
  const extractPropertyValue = (itemData: any, propertyPath: string): number => {
    try {
      const parts = propertyPath.split('.');
      let value: any = itemData;

      // Special handling for common property locations
      if (parts.length === 1) {
        // Try direct attribute first
        if (itemData.attributes && itemData.attributes[parts[0]] !== undefined) {
          value = itemData.attributes[parts[0]];
        }
        // Then check psets/qtos (IsDefinedBy is an array)
        else if (Array.isArray(itemData.IsDefinedBy)) {
          // Search through all property sets
          for (const pset of itemData.IsDefinedBy) {
            if (!pset || !pset.HasProperties) continue;
            
            // HasProperties is an array of property objects
            for (const prop of pset.HasProperties) {
              const propName = unwrapValue(prop.Name) || unwrapValue(prop._category);
              if (propName === parts[0]) {
                // Found the property! Get its value
                value = unwrapValue(prop.NominalValue) || unwrapValue(prop.value);
                break;
              }
            }
            if (value !== itemData) break; // Found it, stop searching
          }
        }
        // Finally check direct property
        if (value === itemData && itemData[parts[0]] !== undefined) {
          value = itemData[parts[0]];
        }
      } else {
        // Multi-part path like "Qto_ColumnBaseQuantities.Length"
        // First part is the property set name, second part is the property name
        const [psetName, propName] = parts;
        
        if (Array.isArray(itemData.IsDefinedBy)) {
          // Find the matching property set
          for (const pset of itemData.IsDefinedBy) {
            const psetNameValue = unwrapValue(pset.Name) || unwrapValue(pset._category);
            
            if (psetNameValue === psetName && pset.HasProperties) {
              // Found the property set, now find the property
              for (const prop of pset.HasProperties) {
                const propNameValue = unwrapValue(prop.Name) || unwrapValue(prop._category);
                if (propNameValue === propName) {
                  value = unwrapValue(prop.NominalValue) || unwrapValue(prop.value);
                  break;
                }
              }
              break;
            }
          }
        }
        
        // Fallback: try navigating the path directly
        if (!value || value === itemData) {
          value = itemData;
          for (const part of parts) {
            if (value && typeof value === 'object') {
              if (value[part] !== undefined) {
                value = value[part];
              } else {
                value = undefined;
                break;
              }
            } else {
              value = undefined;
              break;
            }
          }
        }
      }

      // Unwrap the value if it's an object with .value property
      value = unwrapValue(value);
      
      // Convert to number
      if (typeof value === 'number') {
        return value;
      } else if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
      }

      return 0;
    } catch (error) {
      console.warn(`Error extracting property ${propertyPath}:`, error);
      return 0;
    }
  };

  const extractQuantitiesFromModel = async () => {
    if (!viewerApi) {
      alert('Viewer API is not available');
      return;
    }

    if (!viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) {
      alert('Viewer API does not support required methods');
      return;
    }
    
    if (mappings.length === 0) {
      alert('No mappings configured! Please go to "CONFIGURE MAPPINGS" and set up IFC class to WBS mappings first.');
      return;
    }
    
    if (costData.length === 0) {
      alert('No cost database loaded! Please connect to a cost database first.');
      return;
    }

    setIsExtracting(true);
    setExtractionProgress({ current: 0, total: 0, message: 'Initializing extraction...' });
    
    // Debug: Log mappings state
    console.log('=== EXTRACTION START ===');
    console.log('Loaded mappings:', mappings);
    console.log('Cost data count:', costData.length);
    console.log('Cost data sample:', costData.slice(0, 3));
    
    try {
      // Step 1: Get mapped IFC classes to filter by
      const mappedClasses = [...new Set(mappings.map(m => m.ifcClass))];
      setExtractionProgress({ current: 0, total: mappedClasses.length, message: `Searching for ${mappedClasses.length} IFC class types...` });
      
      // Step 2: Get ALL elements by IFC class (we need the class info preserved)
      const allCategoryMap = await viewerApi.getItemsByCategory(mappedClasses.map(cls => new RegExp(`^${cls}$`, 'i')));
      
      console.log('Category map structure:', {
        keys: Object.keys(allCategoryMap),
        sample: Object.keys(allCategoryMap).length > 0 ? {
          key: Object.keys(allCategoryMap)[0],
          value: allCategoryMap[Object.keys(allCategoryMap)[0]]
        } : null
      });
      
      if (!allCategoryMap || Object.keys(allCategoryMap).length === 0) {
        alert('No elements found matching the configured mappings.');
        setIsExtracting(false);
        setExtractionProgress({ current: 0, total: 0, message: '' });
        return;
      }

      // Step 3: Build a map to track IFC class for each element
      // Need to determine the actual structure first
      const elementToClassMap = new Map<string, string>(); // key: modelId_localId, value: ifcClass
      const categoryMap: { [modelId: string]: number[] } = {};
      
      // Check if the first-level keys are IFC classes or model IDs
      const firstKey = Object.keys(allCategoryMap)[0];
      const firstValue = allCategoryMap[firstKey];
      
      // If firstValue is an array, then keys are model IDs (simpler structure)
      // If firstValue is an object, then keys are IFC classes (nested structure)
      if (Array.isArray(firstValue)) {
        console.log('Simple structure: modelId -> localIds[]');
        // Structure is: { modelId: localIds[] }
        // We need to determine IFC class from element data later
        Object.assign(categoryMap, allCategoryMap);
      } else {
        console.log('Nested structure: ifcClass -> { modelId: localIds[] }');
        // Structure is: { ifcClass: { modelId: localIds[] } }
        for (const [ifcClass, modelsMap] of Object.entries(allCategoryMap)) {
          if (typeof modelsMap !== 'object' || !modelsMap) continue;
          
          for (const [modelId, localIds] of Object.entries(modelsMap as any)) {
            if (!localIds || !Array.isArray(localIds)) continue;
            
            // Track IFC class for each element
            for (const localId of localIds) {
              elementToClassMap.set(`${modelId}_${localId}`, ifcClass);
            }
            
            // Build categoryMap for batching
            if (!categoryMap[modelId]) categoryMap[modelId] = [];
            categoryMap[modelId].push(...localIds);
          }
        }
      }

      // Calculate total elements to process
      const totalElements = elementToClassMap.size || Object.values(categoryMap).reduce((sum, ids) => sum + ids.length, 0);
      setExtractionProgress({ current: 0, total: totalElements, message: `Found ${totalElements} elements to process...` });

      // Pre-cache all element properties for fast access
      // This significantly improves performance by loading all element data at once
      setExtractionProgress({ current: 0, total: totalElements, message: 'Pre-caching element properties...' });
      
      // Collect all globalIds that we'll need
      const allGlobalIdsToCache: string[] = [];
      for (const [modelId, localIds] of Object.entries(categoryMap)) {
        if (!localIds || localIds.length === 0) continue;
        
        // Fetch globalIds for this batch
        try {
          const itemsData = await viewerApi.getItemsDataByModel(modelId, localIds, {
            attributes: ['GlobalId']
          });
          
          for (const itemData of itemsData) {
            const globalId = unwrapValue((itemData as any)._guid);
            if (globalId) {
              allGlobalIdsToCache.push(globalId);
            }
          }
        } catch (err) {
          console.warn(`Failed to get globalIds for model ${modelId}:`, err);
        }
      }
      
      // Pre-cache all elements if addToCache is available
      if (viewerApi.addToCache && allGlobalIdsToCache.length > 0) {
        console.log(`Pre-caching ${allGlobalIdsToCache.length} elements...`);
        try {
          await viewerApi.addToCache(allGlobalIdsToCache);
          console.log('Pre-caching complete!');
        } catch (err) {
          console.warn('Failed to pre-cache elements:', err);
        }
      }

      const extractedQuantities: QuantityItem[] = [];
      let processedElements = 0;

      // Process each model's elements
      for (const [modelId, localIds] of Object.entries(categoryMap)) {
        if (!localIds || localIds.length === 0) continue;

        // Fetch element data in batches
        const batchSize = 100;
        for (let i = 0; i < localIds.length; i += batchSize) {
          const batch = localIds.slice(i, i + batchSize);
          
          setExtractionProgress({ 
            current: processedElements, 
            total: totalElements, 
            message: `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(localIds.length / batchSize)} (${processedElements}/${totalElements} elements)...` 
          });
          
          try {
            const itemsData = await viewerApi.getItemsDataByModel(modelId, batch, {
              attributesDefault: true,
              attributes: ['Name', 'Description', 'GlobalId', 'ObjectType', 'PredefinedType', 'Tag'],
              relations: {
                IsDefinedBy: {
                  attributes: true,
                  relations: true
                },
                IsTypedBy: {
                  attributes: true,
                  relations: false
                }
              }
            });

            // Process each item
            for (const itemData of itemsData) {
              processedElements++;
              
              try {
                // Extract IFC class from _category.value
                const category = (itemData as any)._category;
                let ifcClass = 'IfcProduct';
                if (category && typeof category === 'object' && category.value) {
                  ifcClass = category.value;
                } else if (typeof category === 'string') {
                  ifcClass = category;
                }
                
                if (processedElements === 1) {
                  console.log('First element structure:', {
                    _category: category,
                    ifcClass,
                    IsDefinedBy: itemData.IsDefinedBy,
                    IsDefinedByLength: Array.isArray(itemData.IsDefinedBy) ? itemData.IsDefinedBy.length : 0
                  });
                  
                  // Debug: Log the full IsDefinedBy structure to see what properties are available
                  if (Array.isArray(itemData.IsDefinedBy) && itemData.IsDefinedBy.length > 0) {
                    console.log('First property set structure:', itemData.IsDefinedBy[0]);
                    console.log('Property set Name:', itemData.IsDefinedBy[0].Name);
                    if (itemData.IsDefinedBy[0].HasProperties && itemData.IsDefinedBy[0].HasProperties.length > 0) {
                      console.log('First 3 raw properties:', itemData.IsDefinedBy[0].HasProperties.slice(0, 3));
                      console.log('First property keys:', Object.keys(itemData.IsDefinedBy[0].HasProperties[0]));
                    }
                  }
                  
                  // Debug: Log root attributes
                  console.log('Root attributes:', {
                    ObjectType: (itemData as any).ObjectType,
                    PredefinedType: (itemData as any).PredefinedType,
                    Tag: (itemData as any).Tag,
                    Name: (itemData as any).Name,
                    Description: (itemData as any).Description
                  });
                }
                
                // Get GlobalId
                const globalId = unwrapValue((itemData as any)._guid);
                
                if (processedElements === 1) {
                  console.log('=== OPTIMIZED EXTRACTION (using pre-cached getElementProps) ===');
                  console.log('Elements are pre-cached, so getElementProps calls are fast');
                }
                
                // Extract object type and properties using getElementProps
                // NOTE: Elements are pre-cached, so this should be very fast (reading from cache)
                let objectType: string | undefined;
                let elementProps: any = null;
                
                try {
                  // Fetch element properties from cache (fast!)
                  elementProps = await viewerApi.getElementProps(globalId);
                  
                  if (processedElements === 1) {
                    console.log('First element props structure:', {
                      psets: elementProps?.psets ? Object.keys(elementProps.psets) : [],
                      attributes: elementProps?.attributes ? Object.keys(elementProps.attributes) : []
                    });
                    
                    // Debug: Show all properties in NV_PSteel pset to find where HEB450 is stored
                    if (elementProps?.psets?.NV_PSteel) {
                      console.log('NV_PSteel properties:', elementProps.psets.NV_PSteel);
                    }
                  }
                  
                  // 1. Check property sets (psets) - this is where object type is usually stored
                  if (elementProps?.psets) {
                    for (const psetName in elementProps.psets) {
                      const pset = elementProps.psets[psetName];
                      if (pset && typeof pset === 'object') {
                        // Look for Description, Type, Profile, or similar fields
                        objectType = (pset as any).Description ||
                                    (pset as any).Type ||
                                    (pset as any).Profile ||
                                    (pset as any).ObjectType ||
                                    (pset as any).PredefinedType ||
                                    (pset as any).Reference;
                        
                        if (objectType && typeof objectType === 'string' && objectType.trim()) {
                          if (processedElements <= 3) {
                            console.log(`Found object type "${objectType}" from pset "${psetName}"`);
                          }
                          break;
                        }
                      }
                    }
                  }
                  
                  // 2. Check root attributes as fallback
                  if (!objectType && elementProps?.attributes) {
                    const attrs = elementProps.attributes as Record<string, any>;
                    objectType = attrs.ObjectType || 
                                attrs.PredefinedType || 
                                attrs.Tag ||
                                attrs.Description ||
                                attrs.Name;
                    
                    if (objectType && typeof objectType === 'string' && processedElements <= 3) {
                      console.log(`Found object type "${objectType}" from attributes`);
                    }
                  }
                } catch (err) {
                  console.warn(`Failed to get props for element ${globalId}:`, err);
                }
                
                // Debug: Log object type extraction for first few elements
                if (processedElements <= 3) {
                  console.log(`Element ${processedElements} - Object Type Extraction:`, {
                    ifcClass,
                    objectType,
                    hasPsets: elementProps?.psets ? Object.keys(elementProps.psets).length : 0,
                    hasAttributes: elementProps?.attributes ? Object.keys(elementProps.attributes).length : 0
                  });
                }
                
                // Extract name/description
                const nameValue = unwrapValue((itemData as any).Name) || 
                                 unwrapValue((itemData as any).Description);
                let description: string = typeof nameValue === 'string' ? nameValue : ifcClass;
                
                // Add object type to description if available
                if (objectType && typeof objectType === 'string') {
                  description = `${description} [${objectType}]`;
                }

                // Match with cost database using mappings
                // First try: exact match with both ifcClass AND objectType
                let mapping = mappings.find(m => 
                  m.ifcClass === ifcClass && 
                  m.objectType && 
                  objectType && 
                  m.objectType === objectType
                );
                
                // Second try: match by ifcClass only (for mappings without specific objectType)
                if (!mapping) {
                  mapping = mappings.find(m => m.ifcClass === ifcClass && !m.objectType);
                }
                
                // Debug: Log mapping results for first few elements
                if (processedElements <= 3) {
                  console.log(`Element ${processedElements} - Mapping Result:`, {
                    ifcClass,
                    objectType,
                    mappingFound: !!mapping,
                    mapping: mapping ? {
                      ifcClass: mapping.ifcClass,
                      objectType: mapping.objectType,
                      wbsCode: mapping.wbsCode,
                      quantityProperty: mapping.quantityProperty
                    } : null,
                    availableMappings: mappings.map(m => ({
                      ifcClass: m.ifcClass,
                      objectType: m.objectType,
                      wbsCode: m.wbsCode
                    }))
                  });
                }
                
                const matchedItem = mapping ? costData.find(item => item.wbsCode === mapping.wbsCode) : undefined;
                
                if (processedElements === 1 && !matchedItem && mapping) {
                  console.log('Cost item not found:', {
                    wbsCode: mapping.wbsCode,
                    costDataCount: costData.length,
                    costDataSample: costData.slice(0, 3).map(c => c.wbsCode)
                  });
                }

                // Extract quantity using mapped property from elementProps (cached, so fast!)
                let quantity = 0;
                let unit: string = matchedItem?.unit || 'pcs';

                if (mapping?.quantityProperty && elementProps) {
                  const propertyPath = mapping.quantityProperty;
                  const parts = propertyPath.split('.');
                  
                  if (parts.length === 2 && elementProps.psets) {
                    const [psetName, propName] = parts;
                    
                    // Look in the specified property set
                    const pset = elementProps.psets[psetName];
                    if (pset && typeof pset === 'object') {
                      const value = (pset as any)[propName];
                      quantity = typeof value === 'number' ? value : (typeof value === 'string' ? parseFloat(value) || 0 : 0);
                      
                      if (processedElements <= 3) {
                        console.log(`Found quantity property ${propertyPath} = ${quantity}`);
                      }
                    }
                  } else if (parts.length === 1 && elementProps.attributes) {
                    // Single property name - check attributes
                    const propName = parts[0];
                    const value = (elementProps.attributes as any)[propName];
                    quantity = typeof value === 'number' ? value : (typeof value === 'string' ? parseFloat(value) || 0 : 0);
                    
                    if (processedElements <= 3) {
                      console.log(`Found quantity from attribute ${propName} = ${quantity}`);
                    }
                  }
                  
                  if (quantity === 0 && processedElements <= 3) {
                    console.warn(`Property ${propertyPath} not found or zero for ${ifcClass}`, {
                      availablePsets: elementProps?.psets ? Object.keys(elementProps.psets) : [],
                      samplePset: elementProps?.psets ? Object.entries(elementProps.psets)[0] : null
                    });
                  }
                } else {
                  // No mapping configured - default to count
                  quantity = 1;
                }
                
                // Use the unit from the matched cost item (important!)
                if (matchedItem?.unit) {
                  unit = matchedItem.unit;
                }

                // FORCE FIX: If unit is 'pcs' (pieces), ALWAYS enforce quantity = 1 per element.
                // This overrides any property mapping that might have been automatically selected.
                // The user explicitly requested 'pcs', which in this context means "count of elements".
                if (unit.toLowerCase() === 'pcs') {
                   quantity = 1;
                }

                // Calculate costs
                // Labor cost calculation:
                // If laborHours is defined, laborCost is treated as Hourly Rate.
                // If laborHours is missing/zero, laborCost is treated as Unit labor cost (fallback).
                const hours = matchedItem?.laborHours || 0;
                const unitLaborCost = (hours > 0) 
                  ? (matchedItem?.laborCost || 0) * hours 
                  : (matchedItem?.laborCost || 0);

                const materialCost = matchedItem ? matchedItem.materialCost * quantity : 0;
                const laborCost = matchedItem ? unitLaborCost * quantity : 0;
                const totalCost = materialCost + laborCost;

                extractedQuantities.push({
                  elementId: globalId || `${modelId}_${batch[itemsData.indexOf(itemData)]}`,
                  ifcClass,
                  description: description || ifcClass,
                  quantity,
                  unit,
                  matchedCostItem: matchedItem,
                  materialCost,
                  laborCost,
                  totalCost
                });
              } catch (error) {
                console.error(`Failed to extract quantities for element:`, error);
              }
            }
          } catch (error) {
            console.error(`Failed to fetch batch data for model ${modelId}:`, error);
          }
        }
      }

      console.log('Extraction complete:', {
        totalExtracted: extractedQuantities.length,
        sample: extractedQuantities[0],
        allIfcClasses: [...new Set(extractedQuantities.map(q => q.ifcClass))]
      });
      
      setQuantities(extractedQuantities);
      
      // Group by WBS code (or by IFC class if no mapping)
      const grouped = new Map<string, GroupedQuantity>();
      extractedQuantities.forEach(item => {
        // Use WBS code if mapped, otherwise use IFC class as key
        const key = item.matchedCostItem?.wbsCode || `UNMAPPED_${item.ifcClass}`;
        
        if (!grouped.has(key)) {
          grouped.set(key, {
            wbsCode: item.matchedCostItem?.wbsCode || `[UNMAPPED] ${item.ifcClass}`,
            description: item.matchedCostItem?.description || `Not mapped to cost database`,
            unit: item.matchedCostItem?.unit || item.unit,
            elementCount: 0,
            totalQuantity: 0,
            materialCost: 0,
            laborCost: 0,
            totalCost: 0,
            items: []
          });
        }
        
        const group = grouped.get(key)!;
        group.elementCount++;
        group.totalQuantity += item.quantity;
        group.materialCost += item.materialCost || 0;
        group.laborCost += item.laborCost || 0;
        group.totalCost += item.totalCost || 0;
        group.items.push(item);
      });
      
      setGroupedQuantities(Array.from(grouped.values()));
      setExtractionProgress({ current: totalElements, total: totalElements, message: `Completed! Extracted ${extractedQuantities.length} elements.` });
      setActiveTab('quantities');
      
      // Clear progress after a short delay
      setTimeout(() => {
        setExtractionProgress({ current: 0, total: 0, message: '' });
      }, 2000);
      
    } catch (error) {
      console.error('Failed to extract quantities:', error);
      alert('Failed to extract quantities. See console for details.');
    } finally {
      setIsExtracting(false);
    }
  };

  // Recalculate costs based on current cost database without re-extracting quantities
  const recalculateCosts = () => {
    if (quantities.length === 0) {
      console.warn('No quantities to recalculate');
      return;
    }

    console.log('Recalculating costs with updated cost database...');
    
    // Recalculate costs for each quantity item
    const updatedQuantities = quantities.map(item => {
      // Find the current cost item in the database
      const currentCostItem = item.matchedCostItem 
        ? costData.find(c => c.wbsCode === item.matchedCostItem!.wbsCode)
        : undefined;

      if (currentCostItem) {
        // Recalculate costs with updated rates
        const materialCost = currentCostItem.materialCost * item.quantity;
        const laborCost = currentCostItem.laborCost * item.quantity;
        const totalCost = materialCost + laborCost;

        return {
          ...item,
          matchedCostItem: currentCostItem,
          materialCost,
          laborCost,
          totalCost
        };
      }

      return item;
    });

    setQuantities(updatedQuantities);

    // Recalculate grouped quantities
    const grouped = new Map<string, GroupedQuantity>();
    updatedQuantities.forEach(item => {
      const key = item.matchedCostItem?.wbsCode || `UNMAPPED_${item.ifcClass}`;
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          wbsCode: item.matchedCostItem?.wbsCode || `[UNMAPPED] ${item.ifcClass}`,
          description: item.matchedCostItem?.description || `Not mapped to cost database`,
          unit: item.matchedCostItem?.unit || item.unit,
          elementCount: 0,
          totalQuantity: 0,
          materialCost: 0,
          laborCost: 0,
          totalCost: 0,
          items: []
        });
      }
      
      const group = grouped.get(key)!;
      group.elementCount++;
      group.totalQuantity += item.quantity;
      group.materialCost += item.materialCost || 0;
      group.laborCost += item.laborCost || 0;
      group.totalCost += item.totalCost || 0;
      group.items.push(item);
    });

    setGroupedQuantities(Array.from(grouped.values()));
    console.log('Cost recalculation complete!');
  };

  // Auto-recalculate costs when cost database changes
  useEffect(() => {
    if (quantities.length > 0 && costData.length > 0) {
      recalculateCosts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costData]);

  // Export to XLSX
  const exportToXLSX = async () => {
    try {
      const workbook = new XLSX.Workbook();
      
      // Summary sheet
      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'WBS Code', key: 'wbsCode', width: 15 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'Element Count', key: 'elementCount', width: 15 },
        { header: 'Total Quantity', key: 'totalQuantity', width: 15 },
        { header: 'Material Cost', key: 'materialCost', width: 15 },
        { header: 'Labor Cost', key: 'laborCost', width: 15 },
        { header: 'Total Cost', key: 'totalCost', width: 15 }
      ];

      // Style header row
      summarySheet.getRow(1).font = { bold: true };
      summarySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };

      // Add grouped data
      groupedQuantities.forEach(group => {
        summarySheet.addRow({
          wbsCode: group.wbsCode,
          description: group.description,
          unit: group.unit,
          elementCount: group.elementCount,
          totalQuantity: group.totalQuantity,
          materialCost: group.materialCost,
          laborCost: group.laborCost,
          totalCost: group.totalCost
        });
      });

      // Format currency columns
      ['F', 'G', 'H'].forEach(col => {
        summarySheet.getColumn(col).numFmt = '$#,##0.00';
      });

      // Detail sheet
      const detailSheet = workbook.addWorksheet('Details');
      detailSheet.columns = [
        { header: 'Element ID', key: 'elementId', width: 25 },
        { header: 'IFC Class', key: 'ifcClass', width: 20 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Quantity', key: 'quantity', width: 12 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'WBS Code', key: 'wbsCode', width: 15 },
        { header: 'Material Cost', key: 'materialCost', width: 15 },
        { header: 'Labor Cost', key: 'laborCost', width: 15 },
        { header: 'Total Cost', key: 'totalCost', width: 15 }
      ];

      // Style header row
      detailSheet.getRow(1).font = { bold: true };
      detailSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };

      // Add detail data
      quantities.forEach(item => {
        detailSheet.addRow({
          elementId: item.elementId,
          ifcClass: item.ifcClass,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          wbsCode: item.matchedCostItem?.wbsCode || '[UNMAPPED]',
          materialCost: item.materialCost || 0,
          laborCost: item.laborCost || 0,
          totalCost: item.totalCost || 0
        });
      });

      // Format currency columns
      ['G', 'H', 'I'].forEach(col => {
        detailSheet.getColumn(col).numFmt = '$#,##0.00';
      });

      // Generate file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `QTO_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export XLSX:', error);
      alert('Failed to export to Excel. See console for details.');
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    try {
      // Create CSV content with BOM for UTF-8
      const BOM = '\ufeff';
      
      // Summary CSV
      let summaryCSV = BOM + 'WBS Code,Description,Unit,Element Count,Total Quantity,Material Cost,Labor Cost,Total Cost\n';
      groupedQuantities.forEach(group => {
        summaryCSV += `"${group.wbsCode}","${group.description}","${group.unit}",${group.elementCount},${group.totalQuantity},${group.materialCost.toFixed(2)},${group.laborCost.toFixed(2)},${group.totalCost.toFixed(2)}\n`;
      });

      // Detail CSV
      let detailCSV = BOM + 'Element ID,IFC Class,Description,Quantity,Unit,WBS Code,Material Cost,Labor Cost,Total Cost\n';
      quantities.forEach(item => {
        detailCSV += `"${item.elementId}","${item.ifcClass}","${item.description}",${item.quantity},"${item.unit}","${item.matchedCostItem?.wbsCode || '[UNMAPPED]'}",${(item.materialCost || 0).toFixed(2)},${(item.laborCost || 0).toFixed(2)},${(item.totalCost || 0).toFixed(2)}\n`;
      });

      // Download summary CSV
      const summaryBlob = new Blob([summaryCSV], { type: 'text/csv;charset=utf-8;' });
      const summaryUrl = URL.createObjectURL(summaryBlob);
      const summaryLink = document.createElement('a');
      summaryLink.href = summaryUrl;
      summaryLink.download = `QTO_Summary_${new Date().toISOString().split('T')[0]}.csv`;
      summaryLink.click();
      URL.revokeObjectURL(summaryUrl);

      // Download detail CSV
      const detailBlob = new Blob([detailCSV], { type: 'text/csv;charset=utf-8;' });
      const detailUrl = URL.createObjectURL(detailBlob);
      const detailLink = document.createElement('a');
      detailLink.href = detailUrl;
      detailLink.download = `QTO_Details_${new Date().toISOString().split('T')[0]}.csv`;
      detailLink.click();
      URL.revokeObjectURL(detailUrl);
    } catch (error) {
      console.error('Failed to export CSV:', error);
      alert('Failed to export to CSV. See console for details.');
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
    <Draggable nodeRef={nodeRef} handle=".qto-header" bounds="parent">
      <Paper
        ref={nodeRef}
        sx={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          width: size.width,
          height: isMinimized ? 'auto' : size.height,
          maxHeight: isMinimized ? 'auto' : '90vh',
          maxWidth: '90vw',
          zIndex: 1300,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box'
        }}
        elevation={8}
      >
        <Box
          className="qto-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 2,
            borderBottom: 1,
            borderColor: 'divider',
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            cursor: 'move'
          }}
        >
          <Typography variant="h6">Quantity Take-Off (QTO)</Typography>
          <Box>
            <Tooltip 
              title={
                <Box sx={{ p: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>How to use QTO Panel:</Typography>
                  <Typography variant="body2" sx={{ display: 'block', mb: 0.5 }}>1. <b>Connect Database</b>: Load your cost/price list (Excel).</Typography>
                  <Typography variant="body2" sx={{ display: 'block', mb: 0.5 }}>2. <b>Configure Mappings</b>: Link 3D objects (IFC Classes) to your Cost Items.</Typography>
                  <Typography variant="body2" sx={{ display: 'block', mb: 0.5 }}>3. <b>Extract Quantities</b>: Run the calculation to analyze the model.</Typography>
                  <Typography variant="body2" sx={{ display: 'block' }}>4. <b>Review</b>: See detailed costs and exporting options.</Typography>
                </Box>
              }
              arrow
              placement="left"
            >
                <IconButton 
                  size="small" 
                  sx={{ color: 'inherit', mr: 1 }}
                >
                  <HelpOutlineIcon />
                </IconButton>
            </Tooltip>
            <IconButton 
              onClick={() => setIsMinimized(!isMinimized)} 
              size="small" 
              sx={{ color: 'inherit', mr: 1 }}
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? <OpenInFullIcon /> : <MinimizeIcon />}
            </IconButton>
            {onClose && (
              <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }}>
                <CloseIcon />
              </IconButton>
            )}
          </Box>
        </Box>

        {!isMinimized && (
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Action Bar */}
          <Box sx={{ px: 2, pt: 2, pb: 1, display: 'flex', gap: 1, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
            <Button 
              variant="outlined" 
              size="small"
              onClick={handleConnect}
              disabled={!viewerApi}
            >
              {isConnected ? 'Reconnect Database' : 'Connect Database'}
            </Button>
            <Button 
              variant="outlined" 
              size="small"
              onClick={handleCreateTemplate}
            >
              Download Template
            </Button>
            <Button 
              variant="outlined" 
              size="small"
              startIcon={<SettingsIcon />}
              onClick={() => setIsMappingDialogOpen(true)}
              disabled={!viewerApi || !isConnected}
            >
              Configure Mappings ({mappings.length})
            </Button>
            <Button 
              variant="contained" 
              size="small"
              startIcon={isExtracting ? <CircularProgress size={16} /> : <CalculateIcon />}
              onClick={extractQuantitiesFromModel}
              disabled={!viewerApi || !isConnected || isExtracting || mappings.length === 0}
            >
              {isExtracting ? 'Extracting...' : 'Extract Quantities'}
            </Button>
          </Box>

          {/* Progress Bar */}
          {isExtracting && extractionProgress.total > 0 && (
            <Box sx={{ px: 2, pb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Box sx={{ flex: 1, mr: 2 }}>
                  <LinearProgress 
                    variant="determinate" 
                    value={(extractionProgress.current / extractionProgress.total) * 100} 
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>
                  {extractionProgress.current}/{extractionProgress.total}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {extractionProgress.message}
              </Typography>
            </Box>
          )}

          {/* Tabs */}
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
            <Tab label="Cost Database" value="database" />
            <Tab label={`Quantities (${quantities.length})`} value="quantities" />
          </Tabs>

          {/* Content Area */}
          <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
            {!isConnected && activeTab === 'database' ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body1" gutterBottom>
                  Connect to your local Excel file to manage cost data
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 3 }}>
                  Don't have a cost database file yet? Download a template to get started.
                </Typography>
              </Box>
            ) : activeTab === 'database' ? (
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              Cost Database
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Data is being auto-saved to your local Excel file.
            </Typography>
            
            {costData.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No data in the database. Add rows to your Excel file and reconnect.
              </Typography>
            ) : (
              <TableContainer sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>WBS Code</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell>Material Cost</TableCell>
                      <TableCell>Labor Cost</TableCell>
                      <TableCell>Labor Hours</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {costData.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <TextField 
                            value={row.wbsCode} 
                            onChange={(e) => handleDataChange({ ...row, wbsCode: e.target.value }, index)}
                            size="small"
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <TextField 
                            value={row.description} 
                            onChange={(e) => handleDataChange({ ...row, description: e.target.value }, index)}
                            size="small"
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <TextField 
                            value={row.unit} 
                            onChange={(e) => handleDataChange({ ...row, unit: e.target.value as CostItem['unit'] }, index)}
                            size="small"
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <TextField 
                            type="number" 
                            value={row.materialCost} 
                            onChange={(e) => handleDataChange({ ...row, materialCost: parseFloat(e.target.value) }, index)}
                            size="small"
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <TextField 
                            type="number" 
                            value={row.laborCost} 
                            onChange={(e) => handleDataChange({ ...row, laborCost: parseFloat(e.target.value) }, index)}
                            size="small"
                            fullWidth
                          />
                        </TableCell>
                        <TableCell>
                          <TextField 
                            type="number" 
                            value={row.laborHours} 
                            onChange={(e) => handleDataChange({ ...row, laborHours: parseFloat(e.target.value) }, index)}
                            size="small"
                            fullWidth
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        ) : (
            /* Quantities Tab */
            <Box>
            {quantities.length === 0 ? (
              <Alert severity="info">
                No quantities extracted yet. Configure mappings and click "Extract Quantities".
              </Alert>
            ) : (
              <Box>
                <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2">
                    {showGrouped ? `${groupedQuantities.length} WBS Codes` : `${quantities.length} Elements`} | 
                    Total Cost: ${quantities.reduce((sum, q) => sum + (q.totalCost || 0), 0).toFixed(2)}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" variant="outlined" onClick={exportToXLSX}>
                      Export XLSX
                    </Button>
                    <Button size="small" variant="outlined" onClick={exportToCSV}>
                      Export CSV
                    </Button>
                    <Button size="small" onClick={() => setShowGrouped(!showGrouped)}>
                      {showGrouped ? 'Show Individual' : 'Show Grouped'}
                    </Button>
                  </Box>
                </Box>

                {showGrouped ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell width="50px"></TableCell>
                          <TableCell>WBS</TableCell>
                          <TableCell>Description</TableCell>
                          <TableCell align="right">Qty</TableCell>
                          <TableCell>Unit</TableCell>
                          <TableCell align="right">Total Cost</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {groupedQuantities.map((group) => {
                          const isUnmapped = group.wbsCode.startsWith('[UNMAPPED]');
                          return (
                          <React.Fragment key={group.wbsCode}>
                            <TableRow sx={{ 
                              backgroundColor: isUnmapped ? 'warning.lighter' : 'action.hover',
                              cursor: 'pointer', 
                              '&:hover': { backgroundColor: isUnmapped ? 'warning.light' : 'action.selected' },
                              borderLeft: isUnmapped ? '4px solid #ff9800' : 'none'
                            }} onClick={() => {
                              const newExpanded = new Set(expandedGroups);
                              newExpanded.has(group.wbsCode) ? newExpanded.delete(group.wbsCode) : newExpanded.add(group.wbsCode);
                              setExpandedGroups(newExpanded);
                            }}>
                              <TableCell>
                                <IconButton size="small">
                                  {expandedGroups.has(group.wbsCode) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                              </TableCell>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  {isUnmapped && (
                                    <Typography variant="caption" sx={{ color: 'orange', fontWeight: 'bold' }}>⚠</Typography>
                                  )}
                                  <strong>{group.wbsCode}</strong>
                                </Box>
                              </TableCell>
                              <TableCell>
                                <Box>
                                  {group.description} ({group.elementCount} elements)
                                  {isUnmapped && (
                                    <Typography variant="caption" color="warning.main" display="block">
                                      Configure mappings to assign cost
                                    </Typography>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell align="right"><strong>{group.totalQuantity.toFixed(2)}</strong></TableCell>
                              <TableCell>{group.unit}</TableCell>
                              <TableCell align="right">
                                <Typography variant="body2" fontWeight="bold" color={isUnmapped ? "warning.main" : "primary"}>
                                  ${group.totalCost.toFixed(2)}
                                </Typography>
                              </TableCell>
                            </TableRow>
                            {expandedGroups.has(group.wbsCode) && (
                              <TableRow>
                                <TableCell colSpan={6} sx={{ p: 2, bgcolor: 'background.default' }}>
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>IFC Class</TableCell>
                                        <TableCell>Description</TableCell>
                                        <TableCell align="right">Qty</TableCell>
                                        <TableCell align="right">Cost</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {group.items.map((item, idx) => (
                                        <TableRow key={idx}>
                                          <TableCell><Typography variant="caption">{item.ifcClass}</Typography></TableCell>
                                          <TableCell><Typography variant="caption">{item.description}</Typography></TableCell>
                                          <TableCell align="right"><Typography variant="caption">{item.quantity.toFixed(2)}</Typography></TableCell>
                                          <TableCell align="right"><Typography variant="caption">${item.totalCost?.toFixed(2)}</Typography></TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Box>
                    {quantities.some(q => !q.matchedCostItem) && (
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        Some elements are not mapped to cost items. Configure mappings in "CONFIGURE MAPPINGS" to assign costs and extract correct quantities.
                      </Alert>
                    )}
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>IFC Class</TableCell>
                          <TableCell>Description</TableCell>
                          <TableCell align="right">Quantity</TableCell>
                          <TableCell>WBS</TableCell>
                          <TableCell align="right">Total Cost</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {quantities.map((item, index) => {
                          const isUnmapped = !item.matchedCostItem;
                          return (
                          <TableRow key={index} sx={{ backgroundColor: isUnmapped ? 'warning.lighter' : 'inherit' }}>
                            <TableCell>{item.ifcClass}</TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell align="right">{item.quantity.toFixed(2)} {item.unit}</TableCell>
                            <TableCell>
                              {item.matchedCostItem ? (
                                <Typography variant="caption" color="success.main" fontWeight="bold">
                                  {item.matchedCostItem.wbsCode}
                                </Typography>
                              ) : (
                                <Typography variant="caption" color="warning.main">
                                  [UNMAPPED]
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight="bold" color={isUnmapped ? "warning.main" : "primary"}>
                                ${item.totalCost?.toFixed(2) || '0.00'}
                              </Typography>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  </Box>
                )}
                </Box>
              )}
            </Box>
          )}
          </Box>
        </Box>
        )}
        {!isMinimized && (
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
              '&:hover': { opacity: 1 },
              zIndex: 10
            }}
          />
        )}
      </Paper>
    </Draggable>

    <MappingConfigDialog
      open={isMappingDialogOpen}
      onClose={() => setIsMappingDialogOpen(false)}
      viewerApi={viewerApi || null}
      costItems={costData}
      onMappingsUpdated={(newMappings) => setMappings(newMappings)}
    />
    </>
  );
};
