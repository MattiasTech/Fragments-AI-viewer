import React, { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SaveIcon from '@mui/icons-material/Save';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import type { IfcToWbsMapping, CostItem, MappingTemplate } from './types';
import type { ViewerApi } from '../ids/ids.types';
import { generateMappingSuggestions, suggestQuantityProperty, detectQuantityType, inferQuantityTypeFromIfcClass } from './ai-mapping';
import { loadApiConfig } from '../utils/apiKeys';
import { 
  saveMappings, 
  loadMappings, 
  saveTemplate, 
  loadAllTemplates, 
  deleteTemplate,
  exportTemplateToJson,
  importTemplateFromJson
} from './mapping.store';

interface MappingConfigDialogProps {
  open: boolean;
  onClose: () => void;
  viewerApi: ViewerApi | null;
  costItems: CostItem[];
  onMappingsUpdated: (mappings: IfcToWbsMapping[]) => void;
}

export default function MappingConfigDialog({
  open,
  onClose,
  viewerApi,
  costItems,
  onMappingsUpdated
}: MappingConfigDialogProps) {
  const [mappings, setMappings] = useState<IfcToWbsMapping[]>([]);
  const [availableIfcClasses, setAvailableIfcClasses] = useState<string[]>([]);
  const [ifcClassCounts, setIfcClassCounts] = useState<Record<string, number>>({});
  const [objectTypesByClass, setObjectTypesByClass] = useState<Record<string, string[]>>({});
  const [availablePropertiesByClass, setAvailablePropertiesByClass] = useState<Record<string, string[]>>({});
  const [sampleElementsByClass, setSampleElementsByClass] = useState<Record<string, any>>({});
  const [scanScope, setScanScope] = useState<'all' | 'selected' | 'visible'>('selected');
  const [isScanning, setIsScanning] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load existing mappings and templates
  useEffect(() => {
    if (open) {
      loadMappings().then(setMappings);
      loadAllTemplates().then(setTemplates);
    }
  }, [open]);

  /**
   * Extract numeric property names from element data
   */
  const extractNumericProperties = (itemData: any): string[] => {
    const properties: string[] = [];
    
    // Helper to unwrap values
    const unwrapValue = (val: any): any => {
      if (val && typeof val === 'object' && 'value' in val) {
        return val.value;
      }
      return val;
    };
    
    // Check attributes
    if (itemData.attributes) {
      Object.entries(itemData.attributes).forEach(([key, value]) => {
        const unwrapped = unwrapValue(value);
        if (typeof unwrapped === 'number' || (typeof unwrapped === 'string' && !isNaN(parseFloat(unwrapped as string)))) {
          properties.push(key);
        }
      });
    }
    
    // Check property sets (IsDefinedBy is an array)
    if (Array.isArray(itemData.IsDefinedBy)) {
      for (const pset of itemData.IsDefinedBy) {
        const psetName = unwrapValue(pset.Name) || unwrapValue(pset._category);
        
        if (psetName && pset.HasProperties && Array.isArray(pset.HasProperties)) {
          for (const prop of pset.HasProperties) {
            const propName = unwrapValue(prop.Name) || unwrapValue(prop._category);
            const propValue = unwrapValue(prop.NominalValue) || unwrapValue(prop.value);
            
            if (propName && (typeof propValue === 'number' || (typeof propValue === 'string' && !isNaN(parseFloat(propValue))))) {
              properties.push(`${psetName}.${propName}`);
            }
          }
        }
      }
    }
    
    return properties;
  };

  const scanModelForIfcClasses = async () => {
    if (!viewerApi) return;
    
    setIsScanning(true);
    setError(null);
    
    try {
      let globalIdsToScan: string[] = [];
      
      // Get GlobalIds based on scan scope
      let effectiveScanScope = scanScope;
      
      if (scanScope === 'selected') {
        if (viewerApi.getSelectedGlobalIds) {
          globalIdsToScan = await viewerApi.getSelectedGlobalIds();
          if (globalIdsToScan.length === 0) {
            setError('No elements selected. Please select elements or change scan scope to "All" or "Visible".');
            setIsScanning(false);
            return;
          }
        } else {
          setError('Selected scope not supported. Using all elements instead.');
          effectiveScanScope = 'all';
        }
      } else if (scanScope === 'visible') {
        if (viewerApi.getVisibleGlobalIds) {
          globalIdsToScan = await viewerApi.getVisibleGlobalIds();
          if (globalIdsToScan.length === 0) {
            setError('No visible elements found. Please ensure elements are visible or change scan scope.');
            setIsScanning(false);
            return;
          }
        } else {
          setError('Visible scope not supported. Using all elements instead.');
          effectiveScanScope = 'all';
        }
      }
      
      const ifcClassesMap = new Map<string, number>();
      const objectTypesMap = new Map<string, Set<string>>(); // Track object types per IFC class
      const propertiesMap = new Map<string, Set<string>>(); // Track available properties per IFC class
      const sampleElementsMap = new Map<string, any>(); // Store one sample element per IFC class+type
      
      if (effectiveScanScope === 'all' || globalIdsToScan.length === 0) {
        // Scan all elements (original logic)
        if (!viewerApi.getItemsByCategory || !viewerApi.getItemsDataByModel) {
          setError('Required API methods not available');
          setIsScanning(false);
          return;
        }
        
        const categoryMap = await viewerApi.getItemsByCategory([/.*/]);
        
        for (const [modelId, localIds] of Object.entries(categoryMap)) {
          if (!localIds || localIds.length === 0) continue;
          
          const batchSize = 100;
          for (let i = 0; i < localIds.length; i += batchSize) {
            const batch = localIds.slice(i, i + batchSize);
            
            try {
              const itemsData = await viewerApi.getItemsDataByModel(modelId, batch, {
                attributesDefault: true,
                attributes: ['Name', 'Description', 'ObjectType', 'PredefinedType', 'Tag'],
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
              
              // Debug: Log first item to see structure
              if (i === 0 && itemsData.length > 0) {
                console.log('Sample itemData structure:', itemsData[0]);
              }
              
              // Helper to unwrap values
              const unwrapValue = (val: any): any => {
                if (val && typeof val === 'object' && 'value' in val) {
                  return val.value;
                }
                return val;
              };
              
              for (const itemData of itemsData) {
                // Extract IFC class from _category.value
                const category = (itemData as any)._category;
                let ifcClass = 'IfcProduct';
                if (category && typeof category === 'object' && category.value) {
                  ifcClass = category.value;
                } else if (typeof category === 'string') {
                  ifcClass = category;
                }
                
                if (typeof ifcClass === 'string' && ifcClass.toUpperCase().startsWith('IFC')) {
                  ifcClassesMap.set(ifcClass, (ifcClassesMap.get(ifcClass) || 0) + 1);
                  
                  // Store sample element for this class (first one encountered)
                  if (!sampleElementsMap.has(ifcClass)) {
                    sampleElementsMap.set(ifcClass, itemData);
                    
                    // Extract available numeric properties
                    const props = extractNumericProperties(itemData);
                    if (props.length > 0) {
                      propertiesMap.set(ifcClass, new Set(props));
                    }
                  }
                  
                  // Extract object type from various possible locations in the data structure
                  let objectType: string | undefined;
                  
                  // Extract object type following IFC standard: check property sets first (Tekla Common, etc.)
                  // where standardized metadata is stored per discipline
                  
                  // 1. Check IsTypedBy relationship first (most reliable for object type)
                  if (itemData.IsTypedBy) {
                    const typedBy = Array.isArray(itemData.IsTypedBy) ? itemData.IsTypedBy[0] : itemData.IsTypedBy;
                    if (typedBy) {
                      objectType = unwrapValue(typedBy.Name) || 
                                  unwrapValue(typedBy.Description) ||
                                  unwrapValue(typedBy.ObjectType) ||
                                  unwrapValue(typedBy.PredefinedType);
                    }
                  }
                  
                  // 2. Check root attributes
                  if (!objectType) {
                    objectType = unwrapValue((itemData as any).ObjectType) ||
                                unwrapValue((itemData as any).PredefinedType) ||
                                unwrapValue((itemData as any).Tag) ||
                                unwrapValue((itemData as any).Description) ||
                                unwrapValue((itemData as any).Name);
                    objectType = typeof objectType === 'string' ? objectType : undefined;
                  }
                  
                  if (objectType && typeof objectType === 'string' && objectType.trim() !== '') {
                    if (!objectTypesMap.has(ifcClass)) {
                      objectTypesMap.set(ifcClass, new Set());
                    }
                    objectTypesMap.get(ifcClass)!.add(objectType.trim());
                  }
                }
              }
            } catch (err) {
              console.warn(`Failed to scan batch in model ${modelId}:`, err);
            }
          }
        }
      } else {
        // Scan selected/visible elements only
        const batchSize = 50;
        for (let i = 0; i < globalIdsToScan.length; i += batchSize) {
          const batch = globalIdsToScan.slice(i, i + batchSize);
          
          for (const globalId of batch) {
            try {
              const props = await viewerApi.getElementProps(globalId);
              const ifcClass = props.ifcClass;
              
              if (typeof ifcClass === 'string' && ifcClass.toUpperCase().startsWith('IFC')) {
                ifcClassesMap.set(ifcClass, (ifcClassesMap.get(ifcClass) || 0) + 1);
                
                // Store sample element for this class (first one encountered)
                // Convert props to element-like structure for consistency
                if (!sampleElementsMap.has(ifcClass)) {
                  const sampleElement = {
                    attributes: props.attributes,
                    IsDefinedBy: props.psets,
                    constructor: { name: ifcClass }
                  };
                  sampleElementsMap.set(ifcClass, sampleElement);
                  
                  // Extract available numeric properties
                  const numericProps: string[] = [];
                  if (props.attributes) {
                    const attrs = props.attributes as Record<string, any>;
                    Object.entries(attrs).forEach(([key, value]) => {
                      if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value as string)))) {
                        numericProps.push(key);
                      }
                    });
                  }
                  if (props.psets) {
                    Object.entries(props.psets).forEach(([psetName, psetData]) => {
                      if (psetData && typeof psetData === 'object') {
                        Object.entries(psetData as any).forEach(([key, value]) => {
                          if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value as string)))) {
                            numericProps.push(`${psetName}.${key}`);
                          }
                        });
                      }
                    });
                  }
                  
                  if (numericProps.length > 0) {
                    propertiesMap.set(ifcClass, new Set(numericProps));
                  }
                }
                
                // Extract object type following IFC standard: check property sets first
                // where standardized metadata is stored per discipline
                let objectType: string | undefined;
                
                // 1. Check property sets (psets) - standard location for disciplinary metadata
                if (props.psets) {
                  for (const psetName in props.psets) {
                    const pset = props.psets[psetName];
                    if (pset && typeof pset === 'object') {
                      // Look for Description, Type, or Profile in pset
                      objectType = (pset as any).Description ||
                                  (pset as any).Type ||
                                  (pset as any).Profile ||
                                  (pset as any).ObjectType ||
                                  (pset as any).PredefinedType ||
                                  (pset as any).Reference;
                      if (objectType && typeof objectType === 'string' && objectType.trim()) {
                        break;
                      }
                    }
                  }
                }
                
                // 2. Fallback to root attributes
                if (!objectType && props.attributes) {
                  const attrs = props.attributes as Record<string, any>;
                  objectType = attrs.ObjectType || 
                              attrs.PredefinedType || 
                              attrs.Tag ||
                              attrs.Description ||
                              attrs.Name;
                }
                
                if (objectType && typeof objectType === 'string' && objectType.trim() !== '') {
                  if (!objectTypesMap.has(ifcClass)) {
                    objectTypesMap.set(ifcClass, new Set());
                  }
                  objectTypesMap.get(ifcClass)!.add(objectType.trim());
                }
              }
            } catch (err) {
              console.warn(`Failed to get props for ${globalId}:`, err);
            }
          }
        }
      }
      
      const classes = Array.from(ifcClassesMap.keys()).sort();
      const counts: Record<string, number> = {};
      ifcClassesMap.forEach((count, cls) => {
        counts[cls] = count;
      });
      
      // Convert object types map to Record
      const objectTypes: Record<string, string[]> = {};
      objectTypesMap.forEach((typesSet, cls) => {
        objectTypes[cls] = Array.from(typesSet).sort();
      });
      
      // Convert properties map to Record
      const properties: Record<string, string[]> = {};
      propertiesMap.forEach((propsSet, cls) => {
        properties[cls] = Array.from(propsSet).sort();
      });
      
      // Convert sample elements map to Record
      const sampleElements: Record<string, any> = {};
      sampleElementsMap.forEach((element, cls) => {
        sampleElements[cls] = element;
      });
      
      setAvailableIfcClasses(classes);
      setIfcClassCounts(counts);
      setObjectTypesByClass(objectTypes);
      setAvailablePropertiesByClass(properties);
      setSampleElementsByClass(sampleElements);
      
      console.log('Scanned properties by class:', properties);
      
      if (classes.length === 0) {
        setError('No IFC classes found in model. Please ensure the model is loaded correctly.');
      }
    } catch (err: any) {
      setError(`Failed to scan model: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddMapping = () => {
    setMappings([...mappings, { ifcClass: '', wbsCode: '' }]);
  };

  const handleRemoveMapping = (index: number) => {
    setMappings(mappings.filter((_, i) => i !== index));
  };

  const handleMappingChange = (index: number, field: 'ifcClass' | 'wbsCode' | 'objectType' | 'quantityProperty' | 'quantityType', value: string) => {
    const newMappings = [...mappings];
    if (field === 'objectType' && value === '') {
      // Remove objectType if "All Types" is selected
      const { objectType, ...rest } = newMappings[index];
      newMappings[index] = rest as IfcToWbsMapping;
    } else if (field === 'quantityProperty' && value === '') {
      // Remove quantityProperty if cleared
      const { quantityProperty, quantityType, propertyConfidence, ...rest } = newMappings[index];
      newMappings[index] = rest as IfcToWbsMapping;
    } else if (field === 'quantityProperty' && value) {
      // Auto-detect quantity type when property is selected
      const detectedType = detectQuantityType(value);
      newMappings[index] = { 
        ...newMappings[index], 
        [field]: value,
        quantityType: detectedType as any,
        propertyConfidence: 0.6 // Manual selection has lower confidence than AI
      };
    } else if (field === 'quantityType') {
      // Allow manual override of quantity type
      newMappings[index] = { 
        ...newMappings[index], 
        quantityType: (value as any) || undefined
      };
    } else {
      newMappings[index] = { ...newMappings[index], [field]: value };
    }
    setMappings(newMappings);
  };

  const handleAISuggest = async () => {
    const apiConfig = loadApiConfig();
    if (!apiConfig || !apiConfig.apiKey) {
      setError('Please configure AI API key in Settings first');
      return;
    }

    if (availableIfcClasses.length === 0) {
      setError('No IFC classes found in model');
      return;
    }

    if (costItems.length === 0) {
      setError('Please connect to cost database first');
      return;
    }

    setIsGeneratingAI(true);
    setError(null);

    try {
      const suggestions = await generateMappingSuggestions(
        availableIfcClasses,
        costItems,
        apiConfig.provider,
        apiConfig.apiKey,
        apiConfig.model || (apiConfig.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini')
      );

      // Merge with existing mappings (don't override manual ones)
      const existingIfcClasses = new Set(mappings.map(m => m.ifcClass));
      const newSuggestions = suggestions.filter(s => !existingIfcClasses.has(s.ifcClass));
      
      setMappings([...mappings, ...newSuggestions]);
      
    } catch (err: any) {
      setError(`AI suggestion failed: ${err.message}`);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleAISuggestProperty = async (index: number) => {
    const apiConfig = loadApiConfig();
    if (!apiConfig || !apiConfig.apiKey) {
      setError('Please configure AI API key in Settings first');
      return;
    }

    const mapping = mappings[index];
    if (!mapping.ifcClass || !mapping.wbsCode || !viewerApi) {
      return;
    }

    const costItem = costItems.find(item => item.wbsCode === mapping.wbsCode);
    if (!costItem) {
      setError('Cost item not found');
      return;
    }

    setIsGeneratingAI(true);
    setError(null);

    try {
      // Use stored sample element from scan, or fetch if not available
      let sampleElement = sampleElementsByClass[mapping.ifcClass];
      
      if (!sampleElement) {
        setError(`No sample element found for ${mapping.ifcClass}. Please scan the model first.`);
        return;
      }

      // Ask AI to suggest the best property
      const suggestion = await suggestQuantityProperty(
        mapping.ifcClass,
        mapping.objectType,
        sampleElement,
        costItem.unit,
        apiConfig.provider,
        apiConfig.apiKey,
        apiConfig.model || (apiConfig.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini')
      );

      // Detect quantity type from property or infer from IFC class
      let quantityType = suggestion.quantityType || detectQuantityType(suggestion.propertyName);
      if (!quantityType) {
        quantityType = inferQuantityTypeFromIfcClass(mapping.ifcClass);
      }

      // Update mapping with suggested property and quantity type
      const newMappings = [...mappings];
      newMappings[index] = { 
        ...newMappings[index], 
        quantityProperty: suggestion.propertyName,
        quantityType: quantityType as any,
        propertyConfidence: 0.85 // AI-generated suggestions have good confidence
      };
      setMappings(newMappings);

      console.log('AI Property Suggestion:', suggestion.reasoning, 'Type:', quantityType);
      
    } catch (err: any) {
      setError(`AI property suggestion failed: ${err.message}`);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleSave = async () => {
    const validMappings = mappings.filter(m => m.ifcClass && m.wbsCode);
    await saveMappings(validMappings);
    onMappingsUpdated(validMappings);
    onClose();
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) {
      setError('Please enter a template name');
      return;
    }

    const template: MappingTemplate = {
      id: Date.now().toString(),
      name: templateName,
      createdAt: new Date().toISOString(),
      mappings: mappings.filter(m => m.ifcClass && m.wbsCode)
    };

    await saveTemplate(template);
    setTemplates([...templates, template]);
    setTemplateName('');
    alert('Template saved successfully!');
  };

  const handleLoadTemplate = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setMappings(template.mappings);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (confirm('Delete this template?')) {
      await deleteTemplate(templateId);
      setTemplates(templates.filter(t => t.id !== templateId));
    }
  };

  const handleExportTemplate = () => {
    if (mappings.length === 0) {
      setError('No mappings to export');
      return;
    }

    const template: MappingTemplate = {
      id: Date.now().toString(),
      name: templateName || 'Exported Mapping',
      createdAt: new Date().toISOString(),
      mappings: mappings.filter(m => m.ifcClass && m.wbsCode)
    };

    const json = exportTemplateToJson(template);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qto-mapping-${template.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportTemplate = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const template = importTemplateFromJson(text);
        await saveTemplate(template);
        setTemplates([...templates, template]);
        setMappings(template.mappings);
        alert('Template imported successfully!');
      } catch (err: any) {
        setError(`Import failed: ${err.message}`);
      }
    };
    input.click();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Configure IFC to WBS Mapping
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Map IFC element types to your cost database items. You can map entire classes or specific object types (e.g., HEA200, HEB300) to different WBS codes for granular cost control.
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, mb: 1 }}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Scan Scope</InputLabel>
              <Select
                value={scanScope}
                label="Scan Scope"
                onChange={(e) => {
                  setScanScope(e.target.value as 'all' | 'selected' | 'visible');
                  setAvailableIfcClasses([]);
                  setIfcClassCounts({});
                }}
              >
                <MenuItem value="selected">Selected Elements</MenuItem>
                <MenuItem value="visible">Visible Elements</MenuItem>
                <MenuItem value="all">All Elements</MenuItem>
              </Select>
            </FormControl>
            
            <Button
              variant="outlined"
              size="small"
              onClick={scanModelForIfcClasses}
              disabled={isScanning}
              startIcon={isScanning ? <CircularProgress size={16} /> : undefined}
            >
              {isScanning ? 'Scanning...' : 'Scan Model'}
            </Button>
            
            {availableIfcClasses.length > 0 && (
              <Typography variant="body2" color="primary">
                Found {availableIfcClasses.length} IFC classes
              </Typography>
            )}
          </Box>
        </Box>

        {/* Template Management */}
        <Box sx={{ mb: 2, p: 2, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>Templates</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            {templates.map(template => (
              <Chip
                key={template.id}
                label={`${template.name} (${template.mappings.length})`}
                onClick={() => handleLoadTemplate(template.id)}
                onDelete={() => handleDeleteTemplate(template.id)}
                size="small"
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <TextField
              size="small"
              placeholder="Template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button size="small" startIcon={<SaveIcon />} onClick={handleSaveAsTemplate}>
              Save as Template
            </Button>
            <Button size="small" startIcon={<FileDownloadIcon />} onClick={handleExportTemplate}>
              Export
            </Button>
            <Button size="small" startIcon={<FileUploadIcon />} onClick={handleImportTemplate}>
              Import
            </Button>
          </Box>
        </Box>

        {/* Mappings Table */}
        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell width="16%">IFC Class</TableCell>
                <TableCell width="14%">Object Type</TableCell>
                <TableCell width="22%">Cost Item (WBS)</TableCell>
                <TableCell width="28%">Quantity Property</TableCell>
                <TableCell width="12%">Qty Type</TableCell>
                <TableCell width="8%" align="center">
                  <IconButton size="small" onClick={handleAddMapping} color="primary">
                    <AddIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappings.map((mapping, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <FormControl fullWidth size="small">
                      <Select
                        value={mapping.ifcClass}
                        onChange={(e) => handleMappingChange(index, 'ifcClass', e.target.value)}
                        displayEmpty
                      >
                        <MenuItem value="">
                          <em>Select IFC Class</em>
                        </MenuItem>
                        {availableIfcClasses.map(cls => (
                          <MenuItem key={cls} value={cls}>
                            {cls} {ifcClassCounts[cls] ? `(${ifcClassCounts[cls]} elements)` : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>
                    <FormControl fullWidth size="small">
                      <Select
                        value={mapping.objectType || ''}
                        onChange={(e) => handleMappingChange(index, 'objectType', e.target.value)}
                        displayEmpty
                        disabled={!mapping.ifcClass || !objectTypesByClass[mapping.ifcClass]?.length}
                      >
                        <MenuItem value="">
                          <em>All Types</em>
                        </MenuItem>
                        {mapping.ifcClass && objectTypesByClass[mapping.ifcClass]?.map(type => (
                          <MenuItem key={type} value={type}>
                            {type}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {mapping.ifcClass && objectTypesByClass[mapping.ifcClass]?.length > 0 && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        {objectTypesByClass[mapping.ifcClass].length} type{objectTypesByClass[mapping.ifcClass].length !== 1 ? 's' : ''} available
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <FormControl fullWidth size="small">
                      <Select
                        value={mapping.wbsCode}
                        onChange={(e) => handleMappingChange(index, 'wbsCode', e.target.value)}
                        displayEmpty
                      >
                        <MenuItem value="">
                          <em>Select WBS Code</em>
                        </MenuItem>
                        {costItems.map(item => (
                          <MenuItem key={item.wbsCode} value={item.wbsCode}>
                            {item.wbsCode}: {item.description} ({item.unit})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {mapping.confidence && (
                      <Typography variant="caption" color="text.secondary">
                        AI Confidence: {(mapping.confidence * 100).toFixed(0)}%
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <FormControl fullWidth size="small">
                        <Select
                          value={mapping.quantityProperty || ''}
                          onChange={(e) => handleMappingChange(index, 'quantityProperty', e.target.value)}
                          displayEmpty
                          disabled={!mapping.ifcClass || !mapping.wbsCode}
                        >
                          <MenuItem value="">
                            <em>Select Property</em>
                          </MenuItem>
                          {mapping.ifcClass && availablePropertiesByClass[mapping.ifcClass]?.map(prop => (
                            <MenuItem key={prop} value={prop}>
                              {prop}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <IconButton 
                        size="small" 
                        onClick={() => handleAISuggestProperty(index)}
                        disabled={!mapping.ifcClass || !mapping.wbsCode || isGeneratingAI || !sampleElementsByClass[mapping.ifcClass]}
                        title="AI suggest property"
                      >
                        <AutoFixHighIcon />
                      </IconButton>
                    </Box>
                    {mapping.ifcClass && availablePropertiesByClass[mapping.ifcClass] && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        {availablePropertiesByClass[mapping.ifcClass].length} properties available
                      </Typography>
                    )}
                    {mapping.quantityProperty && (
                      <Box sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="success.main" display="block">
                          ✓ Extract: {mapping.quantityProperty}
                        </Typography>
                        {mapping.quantityType && (
                          <Chip
                            label={`Type: ${mapping.quantityType}`}
                            size="small"
                            variant="outlined"
                            sx={{ mt: 0.5, fontSize: '0.7rem' }}
                            color={mapping.quantityType === 'length' ? 'info' : 
                                   mapping.quantityType === 'area' ? 'warning' :
                                   mapping.quantityType === 'volume' ? 'error' :
                                   mapping.quantityType === 'weight' ? 'secondary' : 'default'}
                          />
                        )}
                        {mapping.propertyConfidence && (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                            Confidence: {(mapping.propertyConfidence * 100).toFixed(0)}%
                          </Typography>
                        )}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    <FormControl fullWidth size="small">
                      <Select
                        value={mapping.quantityType || ''}
                        onChange={(e) => handleMappingChange(index, 'quantityType', e.target.value)}
                        displayEmpty
                        disabled={!mapping.quantityProperty}
                      >
                        <MenuItem value="">
                          <em>Auto</em>
                        </MenuItem>
                        <MenuItem value="length">📏 Length (m)</MenuItem>
                        <MenuItem value="area">📐 Area (m²)</MenuItem>
                        <MenuItem value="volume">📦 Volume (m³)</MenuItem>
                        <MenuItem value="weight">⚖️ Weight (kg)</MenuItem>
                        <MenuItem value="count">🔢 Count (pcs)</MenuItem>
                      </Select>
                    </FormControl>
                    {mapping.quantityType && (
                      <Typography variant="caption" color="info.main" display="block" sx={{ mt: 0.5 }}>
                        ✓ Manual: {mapping.quantityType}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <IconButton size="small" onClick={() => handleRemoveMapping(index)} color="error">
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {mappings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary">
                      No mappings defined. Click + to add or use AI Suggest.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>

      <DialogActions>
        <Button
          startIcon={isGeneratingAI ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
          onClick={handleAISuggest}
          disabled={isGeneratingAI || isScanning}
        >
          {isGeneratingAI ? 'Generating...' : 'AI Suggest Mappings'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save & Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
