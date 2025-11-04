/**
 * Web Worker for parallel IDS property extraction
 * Processes batches of elements and extracts their properties
 */

export interface WorkerElementData {
  modelId: string;
  localId: number;
  globalId: string;
  rawData: Record<string, unknown>;
}

export interface WorkerRequest {
  type: 'process-batch';
  batchId: number;
  elements: WorkerElementData[];
}

export interface WorkerResponse {
  type: 'batch-complete';
  batchId: number;
  results: ProcessedElement[];
}

export interface WorkerError {
  type: 'error';
  batchId: number;
  error: string;
}

export interface ProcessedElement {
  modelId: string;
  localId: number;
  globalId: string;
  ifcClass: string;
  psets: Record<string, Record<string, unknown>>;
  attributes: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/**
 * Extract property sets from raw IFC data
 */
function extractPropertySets(data: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const psets: Record<string, Record<string, unknown>> = {};
  
  // Look for property sets in common locations
  const psetKeys = ['PropertySets', 'propertySets', 'psets', 'Psets'];
  
  for (const key of psetKeys) {
    const value = data[key];
    if (value && typeof value === 'object') {
      // Handle array of property sets
      if (Array.isArray(value)) {
        for (const pset of value) {
          if (pset && typeof pset === 'object') {
            const name = pset.Name || pset.name || 'Unknown';
            const props: Record<string, unknown> = {};
            
            // Extract properties from the pset
            if (pset.HasProperties && Array.isArray(pset.HasProperties)) {
              for (const prop of pset.HasProperties) {
                if (prop && typeof prop === 'object') {
                  const propName = prop.Name || prop.name;
                  const propValue = prop.NominalValue || prop.value || prop.Value;
                  if (propName) {
                    props[String(propName)] = propValue;
                  }
                }
              }
            } else {
              // Property set might be flat object
              Object.entries(pset).forEach(([k, v]) => {
                if (k !== 'Name' && k !== 'name' && k !== 'type') {
                  props[k] = v;
                }
              });
            }
            
            psets[String(name)] = props;
          }
        }
      } 
      // Handle direct object of property sets
      else {
        Object.entries(value).forEach(([psetName, psetValue]) => {
          if (psetValue && typeof psetValue === 'object') {
            psets[psetName] = psetValue as Record<string, unknown>;
          }
        });
      }
    }
  }
  
  // Also check for direct property sets at root level
  Object.entries(data).forEach(([key, value]) => {
    if (key.startsWith('Pset_') || key.startsWith('pset_')) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        psets[key] = value as Record<string, unknown>;
      }
    }
  });
  
  return psets;
}

/**
 * Extract basic attributes (non-pset properties)
 */
function extractAttributes(data: Record<string, unknown>): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  
  // Common IFC attributes
  const attributeKeys = [
    'Name', 'Description', 'ObjectType', 'Tag', 'PredefinedType',
    'GlobalId', 'OwnerHistory', 'LongName', 'CompositionType'
  ];
  
  attributeKeys.forEach(key => {
    if (key in data) {
      attributes[key] = data[key];
    }
  });
  
  return attributes;
}

/**
 * Process a single element
 */
function processElement(element: WorkerElementData): ProcessedElement {
  const { modelId, localId, globalId, rawData } = element;
  
  // Extract IFC class
  const ifcClass = String(
    rawData.type || 
    rawData.Type || 
    rawData.IfcType || 
    rawData.EntityType ||
    rawData.Name || 
    'UNKNOWN'
  ).toUpperCase();
  
  // Extract property sets
  const psets = extractPropertySets(rawData);
  
  // Extract basic attributes
  const attributes = extractAttributes(rawData);
  
  return {
    modelId,
    localId,
    globalId,
    ifcClass,
    psets,
    attributes,
    raw: rawData
  };
}

/**
 * Main message handler
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { type, batchId, elements } = event.data;
  
  if (type === 'process-batch') {
    try {
      const results: ProcessedElement[] = [];
      
      for (const element of elements) {
        try {
          const processed = processElement(element);
          results.push(processed);
        } catch (error) {
          // Avoid using a user-dependent string as the format string for
          // util.format (used by console.* under Node). Construct a constant
          // format and pass the potentially untrusted value as an argument
          // so it won't be interpreted as a format string.
          console.error('Failed to process element %s', element.globalId, error);
          // Continue processing other elements
        }
      }
      
      const response: WorkerResponse = {
        type: 'batch-complete',
        batchId,
        results
      };
      
      self.postMessage(response);
    } catch (error) {
      const errorResponse: WorkerError = {
        type: 'error',
        batchId,
        error: error instanceof Error ? error.message : String(error)
      };
      
      self.postMessage(errorResponse);
    }
  }
};

// Notify that worker is ready
self.postMessage({ type: 'ready' });
