export interface CostItem {
  wbsCode: string;
  description: string;
  unit: 'm' | 'm2' | 'm3' | 'kg' | 'pcs';
  materialCost: number;
  laborCost: number; // Hourly rate
  laborHours: number; // Hours per unit
}

export interface IfcToWbsMapping {
  ifcClass: string;
  objectType?: string; // Optional: specific type like "HEA200", "Type A", etc.
  wbsCode: string;
  confidence?: number; // AI confidence score 0-1
  quantityProperty?: string; // Property to extract quantity from (e.g., "Length", "Area", "NetVolume")
  quantityType?: 'length' | 'area' | 'volume' | 'weight' | 'count'; // Detected quantity dimension
  quantityFormula?: string; // Optional formula like "Width * Height"
  propertyConfidence?: number; // Confidence in the quantity property detection (0-1)
}

export interface PropertyMappingSuggestion {
  propertyName: string;
  sampleValue: any;
  confidence: number;
  reasoning: string;
}

export interface MappingTemplate {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  mappings: IfcToWbsMapping[];
}
