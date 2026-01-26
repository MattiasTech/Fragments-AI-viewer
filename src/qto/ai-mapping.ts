import { sendGeminiMessage } from '../ai/gemini';
import { sendOpenAIMessage } from '../ai/openai';
import type { AIProvider } from '../utils/apiKeys';
import type { IfcToWbsMapping, CostItem } from './types';

interface AIMappingSuggestion extends IfcToWbsMapping {
  reasoning?: string;
}

/**
 * Detect quantity type from property name
 * Uses heuristics based on IFC property naming conventions
 */
export function detectQuantityType(
  propertyName: string
): 'length' | 'area' | 'volume' | 'weight' | 'count' | null {
  if (!propertyName) return null;
  
  const name = propertyName.toLowerCase();
  
  // Volume/3D patterns
  if (
    name.includes('volume') || 
    name.includes('netvolume') || 
    name.includes('grossvolume') ||
    name.includes('liquidvolume')
  ) {
    return 'volume';
  }
  
  // Area/2D patterns
  if (
    name.includes('area') || 
    name.includes('netarea') || 
    name.includes('grossarea') ||
    name.includes('sidewallarea') ||
    name.includes('footprintarea') ||
    name.includes('netsidearea') ||
    name.includes('grosssidearea')
  ) {
    return 'area';
  }
  
  // Length/1D patterns
  if (
    name.includes('length') || 
    name.includes('netlength') || 
    name.includes('grosslength') ||
    name.includes('perimeter') ||
    name.includes('height') ||
    name.includes('width') ||
    name.includes('depth') ||
    name.includes('diameter') ||
    name.includes('radius')
  ) {
    return 'length';
  }
  
  // Weight/Mass patterns
  if (
    name.includes('mass') || 
    name.includes('weight') ||
    name.includes('netmass') ||
    name.includes('grossmass')
  ) {
    return 'weight';
  }
  
  // Count patterns
  if (
    name.includes('quantity') ||
    name.includes('count') ||
    name.includes('number')
  ) {
    return 'count';
  }
  
  return null;
}

/**
 * Infer quantity type from IFC class
 * Returns the most likely quantity type for an element class
 */
export function inferQuantityTypeFromIfcClass(ifcClass: string): 'length' | 'area' | 'volume' | 'weight' | 'count' {
  const cls = ifcClass.toLowerCase();
  
  // Volume-based elements
  if (cls.includes('slab') || cls.includes('beam') || cls.includes('column')) {
    return 'volume';
  }
  
  // Length-based elements (structural members)
  if (cls.includes('wall') || cls.includes('pipe') || cls.includes('rebar') || cls.includes('reinforcement')) {
    return 'length';
  }
  
  // Area-based elements
  if (cls.includes('wall') || cls.includes('door') || cls.includes('window') || cls.includes('slab')) {
    return 'area';
  }
  
  // Weight-based (metals, structural components)
  if (cls.includes('cable') || cls.includes('reinforcement') || cls.includes('plate')) {
    return 'weight';
  }
  
  // Count for misc
  if (cls.includes('fastener') || cls.includes('fixture')) {
    return 'count';
  }
  
  // Default to count
  return 'count';
}

/**
 * Generate mapping suggestions using AI
 */
export async function generateMappingSuggestions(
  ifcClasses: string[],
  costItems: CostItem[],
  provider: AIProvider,
  apiKey: string,
  model: string
): Promise<AIMappingSuggestion[]> {
  
  const prompt = `You are an expert in BIM (Building Information Modeling) and construction cost estimation.

I have IFC elements from a BIM model and a cost database. Please suggest the best mappings between IFC classes and cost items.

IFC Classes found in the model:
${ifcClasses.map((cls, i) => `${i + 1}. ${cls}`).join('\n')}

Cost Database Items (WBS Code: Description - Unit):
${costItems.map((item, i) => `${i + 1}. ${item.wbsCode}: ${item.description} (${item.unit})`).join('\n')}

Please analyze and return a JSON array of mappings with confidence scores. Format:
[
  {
    "ifcClass": "IfcWall",
    "wbsCode": "3.1.1",
    "confidence": 0.95,
    "reasoning": "Walls map to drywall partition based on description"
  }
]

Rules:
1. Only suggest mappings where you have high confidence (>0.7)
2. Consider the unit of measurement (m, m2, m3, pcs, kg)
3. MEP elements (pipes, ducts, cables) should map to MEP cost items
4. Structural elements (beams, columns, slabs) should map to structural items
5. Architectural elements (walls, doors, windows) should map to architectural items
6. If no good match exists, omit that IFC class from the results

Return ONLY the JSON array, no additional text.`;

  let responseText: string;
  
  if (provider === 'gemini') {
    responseText = await sendGeminiMessage(apiKey, prompt, model);
  } else {
    responseText = await sendOpenAIMessage(apiKey, prompt, model);
  }

  // Extract JSON from response (handle cases where AI adds explanation)
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON array');
  }

  const suggestions = JSON.parse(jsonMatch[0]) as AIMappingSuggestion[];
  
  // Validate suggestions
  const validSuggestions = suggestions.filter(s => 
    s.ifcClass && 
    s.wbsCode && 
    typeof s.confidence === 'number' &&
    s.confidence >= 0.7 &&
    ifcClasses.includes(s.ifcClass) &&
    costItems.some(item => item.wbsCode === s.wbsCode)
  );

  return validSuggestions;
}

/**
 * Get AI explanation for a specific mapping
 */
export async function explainMapping(
  ifcClass: string,
  costItem: CostItem,
  provider: AIProvider,
  apiKey: string,
  model: string
): Promise<string> {
  
  const prompt = `Explain why IFC element "${ifcClass}" should or should not map to cost item "${costItem.wbsCode}: ${costItem.description} (${costItem.unit})".

Consider:
- Element type compatibility
- Unit of measurement alignment
- Construction discipline (MEP/Structural/Architectural)
- Typical construction practices

Provide a brief 2-3 sentence explanation.`;

  if (provider === 'gemini') {
    return await sendGeminiMessage(apiKey, prompt, model);
  } else {
    return await sendOpenAIMessage(apiKey, prompt, model);
  }
}

/**
 * Suggest which property to use for quantity extraction using AI
 */
export async function suggestQuantityProperty(
  ifcClass: string,
  objectType: string | undefined,
  sampleElementData: any,
  unit: 'm' | 'm2' | 'm3' | 'kg' | 'pcs',
  provider: AIProvider,
  apiKey: string,
  model: string
): Promise<{ propertyName: string; reasoning: string; quantityType?: string }> {
  
  // Extract available properties from sample data
  const availableProps: Record<string, any> = {};
  
  // Check attributes
  if (sampleElementData.attributes) {
    Object.entries(sampleElementData.attributes).forEach(([key, value]) => {
      if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))) {
        availableProps[`attributes.${key}`] = value;
      }
    });
  }
  
  // Check property sets (psets)
  if (sampleElementData.IsDefinedBy) {
    Object.entries(sampleElementData.IsDefinedBy).forEach(([psetName, psetData]) => {
      if (psetData && typeof psetData === 'object') {
        Object.entries(psetData as any).forEach(([key, value]) => {
          if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)))) {
            availableProps[`${psetName}.${key}`] = value;
          }
        });
      }
    });
  }
  
  if (Object.keys(availableProps).length === 0) {
    throw new Error('No numeric properties found in sample element');
  }
  
  const prompt = `You are an expert in IFC (Industry Foundation Classes) BIM data extraction.

I need to extract quantity from this IFC element for cost estimation:
- IFC Class: ${ifcClass}
${objectType ? `- Object Type: ${objectType}` : ''}
- Required Unit: ${unit}

Available numeric properties from a sample element:
${Object.entries(availableProps).map(([key, value]) => `  - ${key}: ${value}`).join('\n')}

Please analyze and suggest the BEST property to use for quantity extraction.

Guidelines:
- For "m" (linear): Use Length, Height, or similar linear properties
- For "m2" (area): Use Area, NetArea, GrossArea, NetSideArea, or similar
- For "m3" (volume): Use Volume, NetVolume, GrossVolume, or similar  
- For "kg" (mass): Use Mass, NetMass, GrossMass, or similar
- For "pcs" (count): Usually count elements as 1 each, but may use Quantity if available
- Consider property naming conventions (e.g., "Qto_*BaseQuantities" are official quantity sets)
- Prefer "Net" values over "Gross" when both exist

Return ONLY a JSON object with this format:
{
  "propertyName": "exact.property.path",
  "reasoning": "brief explanation of why this property is best"
}`;

  let responseText: string;
  
  if (provider === 'gemini') {
    responseText = await sendGeminiMessage(apiKey, prompt, model);
  } else {
    responseText = await sendOpenAIMessage(apiKey, prompt, model);
  }

  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON');
  }

  const result = JSON.parse(jsonMatch[0]);
  
  if (!result.propertyName || !result.reasoning) {
    throw new Error('AI response missing required fields');
  }

  // Detect quantity type from the property name
  const quantityType = detectQuantityType(result.propertyName);

  return {
    propertyName: result.propertyName,
    reasoning: result.reasoning,
    quantityType: quantityType || undefined
  };
}
