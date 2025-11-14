import { get, set, del, keys } from 'idb-keyval';
import type { IfcToWbsMapping, MappingTemplate } from './types';

const MAPPING_KEY = 'qto-current-mappings';
const TEMPLATES_PREFIX = 'qto-template-';

/**
 * Save current mappings to IndexedDB
 */
export async function saveMappings(mappings: IfcToWbsMapping[]): Promise<void> {
  await set(MAPPING_KEY, mappings);
}

/**
 * Load current mappings from IndexedDB
 */
export async function loadMappings(): Promise<IfcToWbsMapping[]> {
  const mappings = await get<IfcToWbsMapping[]>(MAPPING_KEY);
  return mappings || [];
}

/**
 * Clear current mappings
 */
export async function clearMappings(): Promise<void> {
  await del(MAPPING_KEY);
}

/**
 * Save a mapping template
 */
export async function saveTemplate(template: MappingTemplate): Promise<void> {
  await set(`${TEMPLATES_PREFIX}${template.id}`, template);
}

/**
 * Load a specific template
 */
export async function loadTemplate(id: string): Promise<MappingTemplate | undefined> {
  return await get<MappingTemplate>(`${TEMPLATES_PREFIX}${id}`);
}

/**
 * Load all templates
 */
export async function loadAllTemplates(): Promise<MappingTemplate[]> {
  const allKeys = await keys();
  const templateKeys = allKeys.filter(key => 
    typeof key === 'string' && key.startsWith(TEMPLATES_PREFIX)
  );
  
  const templates: MappingTemplate[] = [];
  for (const key of templateKeys) {
    const template = await get<MappingTemplate>(key);
    if (template) {
      templates.push(template);
    }
  }
  
  return templates.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Delete a template
 */
export async function deleteTemplate(id: string): Promise<void> {
  await del(`${TEMPLATES_PREFIX}${id}`);
}

/**
 * Export template to JSON string
 */
export function exportTemplateToJson(template: MappingTemplate): string {
  return JSON.stringify(template, null, 2);
}

/**
 * Import template from JSON string
 */
export function importTemplateFromJson(jsonString: string): MappingTemplate {
  const template = JSON.parse(jsonString) as MappingTemplate;
  
  // Validate structure
  if (!template.id || !template.name || !Array.isArray(template.mappings)) {
    throw new Error('Invalid template format');
  }
  
  return template;
}
