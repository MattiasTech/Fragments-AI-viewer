import { XMLParser } from 'fast-xml-parser';
import type { DetailRow, ElementData, RuleResult } from '../ids.types';

const parser = new XMLParser({
  ignoreAttributes: false,
  allowBooleanAttributes: true,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

type Cardinality = {
  min: number;
  max?: number;
};

type PropertyConstraint = {
  path: string;
  expected?: string[];
  cardinality?: Cardinality;
  description?: string;
};

type CompiledRule = {
  id: string;
  title: string;
  applicability: {
    ifcClasses: string[];
  };
  properties: PropertyConstraint[];
};

const NORMALIZE_TOKEN_REGEX = /[^a-zA-Z0-9_.:-]+/g;

const normalizeToken = (value: string | undefined): string => {
  if (!value) return '';
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(NORMALIZE_TOKEN_REGEX, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
};

const normalizeIfcClass = (value: string | undefined): string => {
  if (!value) return '';
  return value.trim();
};

const toArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

const readText = (node: any): string | undefined => {
  if (node == null) return undefined;
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object') {
    if (typeof node['@_value'] === 'string') return node['@_value'].trim();
    if (typeof node.value === 'string') return node.value.trim();
    if (typeof node['#text'] === 'string') return node['#text'].trim();
  }
  return undefined;
};

const parseCardinality = (raw: any): Cardinality | undefined => {
  const text = readText(raw);
  if (!text) return undefined;
  const [minPart, maxPart] = text.split(':');
  const min = Number(minPart);
  const max = maxPart === undefined || maxPart === '*' ? undefined : Number(maxPart);
  if (!Number.isFinite(min)) return undefined;
  if (max !== undefined && !Number.isFinite(max)) return undefined;
  return { min, max };
};

const splitDocuments = (xml: string): string[] => {
  const trimmed = xml.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/<ids:ids[\s\S]*?<\/ids:ids>/gi);
  if (matches && matches.length) {
    return matches;
  }
  return [trimmed];
};

const extractSpecifications = (doc: any): any[] => {
  if (!doc) return [];
  const root = doc.ids ?? doc.IDS ?? doc;
  if (!root) return [];
  const specs = root.specification ?? root.Specification ?? [];
  return toArray(specs);
};

const parsePropertyConstraint = (propertyNode: any): PropertyConstraint | null => {
  const rawPset = readText(propertyNode.propertySet ?? propertyNode.PropertySet);
  const rawName = readText(propertyNode.name ?? propertyNode.Name);
  if (!rawPset || !rawName) return null;
  const path = `${normalizeToken(rawPset)}.${normalizeToken(rawName)}`;
  const cardinality = parseCardinality(propertyNode.cardinality ?? propertyNode.Cardinality);
  const expectedNodes = toArray(propertyNode.value ?? propertyNode.Value ?? propertyNode.accept ?? propertyNode.Accept);
  const expected = expectedNodes
    .map((entry) => readText(entry))
    .filter((entry): entry is string => Boolean(entry && entry.length));
  const description = readText(propertyNode.description ?? propertyNode.Description);
  return {
    path,
    expected: expected.length ? expected : undefined,
    cardinality,
    description,
  };
};

const parseRule = (spec: any, index: number): CompiledRule | null => {
  const id = readText(spec['@_id'] ?? spec['@_identifier']) ?? `spec-${index + 1}`;
  const title = readText(spec['@_name'] ?? spec.name ?? spec.Name) ?? id;

  const applicability = spec.applicability ?? spec.Applicability ?? spec['ids:applicability'];
  const entities = toArray(applicability?.entity ?? applicability?.Entity ?? applicability?.['ids:entity']);
  const ifcClasses = entities
    .map((entity) => normalizeIfcClass(readText(entity['@_name'] ?? entity.name ?? entity.Name ?? entity['#text'])))
    .filter((entry) => entry.length);

  const requirementBlock = spec.requirement ?? spec.Requirement ?? spec['ids:requirement'];
  const requirements = toArray(requirementBlock);
  const properties: PropertyConstraint[] = [];
  requirements.forEach((requirement) => {
    const propertyCandidates = toArray(
      requirement?.property ?? requirement?.Property ?? requirement?.['ids:property'] ?? requirement?.properties ?? []
    );
    propertyCandidates.forEach((propertyNode) => {
      const constraint = parsePropertyConstraint(propertyNode);
      if (constraint) {
        properties.push(constraint);
      }
    });
  });

  if (!properties.length) return null;

  return {
    id,
    title,
    applicability: { ifcClasses },
    properties,
  };
};

export const idsToJsonSchemas = (xml: string): CompiledRule[] => {
  const documents = splitDocuments(xml);
  const compiled: CompiledRule[] = [];
  documents.forEach((text) => {
    try {
      const parsed = parser.parse(text);
      const specs = extractSpecifications(parsed);
      specs.forEach((spec: any, index: number) => {
        const rule = parseRule(spec, index + compiled.length);
        if (rule) {
          compiled.push(rule);
        }
      });
    } catch (error) {
      console.warn('Failed to parse IDS specification', error);
    }
  });
  return compiled;
};

const getPropertyValue = (properties: Record<string, unknown>, path: string): string | undefined => {
  if (path in properties) {
    const value = properties[path];
    return typeof value === 'string' ? value : value?.toString();
  }
  const lower = path.toLowerCase();
  for (const [key, value] of Object.entries(properties)) {
    if (key.toLowerCase() === lower) {
      return typeof value === 'string' ? value : value?.toString();
    }
  }
  return undefined;
};

const evaluateConstraint = (
  element: ElementData,
  constraint: PropertyConstraint
): { status: 'PASSED' | 'FAILED'; actual?: string; reason?: string } => {
  const actual = getPropertyValue(element.properties, constraint.path);
  if (actual == null || actual === '') {
    if (constraint.cardinality && constraint.cardinality.min > 0) {
      return { status: 'FAILED', reason: 'Property missing', actual: actual ?? '' };
    }
    if (!constraint.cardinality) {
      return { status: 'FAILED', reason: 'Property missing', actual: actual ?? '' };
    }
  }
  if (constraint.expected && constraint.expected.length) {
    const normalizedActual = actual?.trim?.() ?? '';
    const matches = constraint.expected.some((expected) => expected === normalizedActual);
    if (!matches) {
      return {
        status: 'FAILED',
        reason: `Value does not match expected list (${constraint.expected.join(', ')})`,
        actual: normalizedActual,
      };
    }
  }
  return { status: 'PASSED', actual: actual ?? '' };
};

export const validateIfcJson = (
  rules: CompiledRule[],
  elements: ElementData[]
): { rules: RuleResult[]; rows: DetailRow[] } => {
  const summaries: RuleResult[] = rules.map((rule) => ({ id: rule.id, title: rule.title, passed: [], failed: [], na: [] }));
  const detailRows: DetailRow[] = [];

  const applicableCache = new Map<string, Set<string>>();

  rules.forEach((rule, ruleIndex) => {
    const summary = summaries[ruleIndex];
    if (rule.applicability.ifcClasses.length) {
      applicableCache.set(rule.id, new Set(rule.applicability.ifcClasses.map((entry) => entry.toLowerCase())));
    }
  });

  elements.forEach((element) => {
    rules.forEach((rule, ruleIndex) => {
      const summary = summaries[ruleIndex];
      const classSet = applicableCache.get(rule.id);
      const elementClass = element.ifcClass?.toLowerCase?.() ?? '';
      if (classSet && classSet.size && !classSet.has(elementClass)) {
        summary.na.push(element.GlobalId);
        detailRows.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          globalId: element.GlobalId,
          ifcClass: element.ifcClass,
          status: 'NA',
          reason: 'Entity not applicable',
        });
        return;
      }

      if (!rule.properties.length) {
        summary.na.push(element.GlobalId);
        return;
      }

      const failureRows: DetailRow[] = [];
      const passRows: DetailRow[] = [];
      let hasFailure = false;

      rule.properties.forEach((constraint) => {
        const evaluation = evaluateConstraint(element, constraint);
        const baseRow: Omit<DetailRow, 'status'> = {
          ruleId: rule.id,
          ruleTitle: rule.title,
          globalId: element.GlobalId,
          ifcClass: element.ifcClass,
          propertyPath: constraint.path,
          expected: constraint.expected?.join(', '),
          actual: evaluation.actual,
        };
        if (evaluation.status === 'FAILED') {
          hasFailure = true;
          failureRows.push({
            ...baseRow,
            reason: evaluation.reason ?? constraint.description,
            status: 'FAILED',
          });
        } else {
          passRows.push({
            ...baseRow,
            status: 'PASSED',
          });
        }
      });

      if (hasFailure) {
        summary.failed.push(element.GlobalId);
        detailRows.push(...failureRows);
        return;
      }

      if (passRows.length) {
        summary.passed.push(element.GlobalId);
        detailRows.push(...passRows);
      } else {
        summary.na.push(element.GlobalId);
        detailRows.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          globalId: element.GlobalId,
          ifcClass: element.ifcClass,
          status: 'NA',
          reason: 'No property checks produced a result',
        });
      }
    });
  });

  return { rules: summaries, rows: detailRows };
};
