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
  dataType?: string;
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
    const candidates = [
      node['@_value'],
      node.value,
      node.Value,
      node['#text'],
      node.simpleValue,
      node.SimpleValue,
      node['ids:simpleValue'],
      node['ids:SimpleValue'],
      node.text,
      node.Text,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length) return trimmed;
      }
    }

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') {
        const extracted = readText(candidate);
        if (extracted) return extracted;
      }
    }

    for (const value of Object.values(node)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length) return trimmed;
      }
      if (value && typeof value === 'object') {
        const extracted = readText(value);
        if (extracted) return extracted;
      }
    }
  }
  return undefined;
};

const parseCardinalityKeyword = (keyword: string | undefined): Cardinality | undefined => {
  if (!keyword) return undefined;
  const normalized = keyword.trim().toLowerCase();
  switch (normalized) {
    case 'required':
      return { min: 1 };
    case 'optional':
      return { min: 0 };
    case 'prohibited':
    case 'forbidden':
    case 'excluded':
      return { min: 0, max: 0 };
    default:
      return undefined;
  }
};

const parseCardinality = (raw: any, attribute?: string | undefined): Cardinality | undefined => {
  const keywordCardinality = parseCardinalityKeyword(attribute);
  if (keywordCardinality) {
    return keywordCardinality;
  }

  const text = readText(raw) ?? attribute;
  if (!text) return undefined;
  const parts = text.split(':');
  if (parts.length === 1) {
    const keyword = parseCardinalityKeyword(parts[0]);
    if (keyword) return keyword;
  }
  const [minPart, maxPart] = parts;
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

const collectExpectedValues = (propertyNode: any): string[] => {
  const results = new Set<string>();
  const addEntry = (entry: any) => {
    if (entry == null) return;
    const candidates = Array.isArray(entry) ? entry : [entry];
    candidates.forEach((candidate) => {
      const text = readText(candidate);
      if (text) {
        results.add(text);
      } else if (candidate && typeof candidate === 'object') {
        Object.values(candidate).forEach((value) => {
          const nested = readText(value);
          if (nested) {
            results.add(nested);
          }
        });
      }
    });
  };

  const allowedValues = propertyNode.allowedValues ?? propertyNode.AllowedValues ?? propertyNode['ids:allowedValues'];
  if (allowedValues) {
    addEntry(allowedValues);
    const valueContainers = [allowedValues.values, allowedValues.Values, allowedValues['ids:values']];
    valueContainers.forEach((container) => {
      if (!container) return;
      const items = Array.isArray(container) ? container : [container];
      items.forEach((item) => {
        addEntry(item);
        addEntry(item.value ?? item.Value ?? item['ids:value']);
      });
    });
  }

  addEntry(propertyNode.value ?? propertyNode.Value ?? propertyNode['ids:value']);
  addEntry(propertyNode.accept ?? propertyNode.Accept ?? propertyNode['ids:accept']);

  return Array.from(results.values()).filter((entry) => entry.length);
};

const parsePropertyConstraint = (propertyNode: any): PropertyConstraint | null => {
  if (!propertyNode || typeof propertyNode !== 'object') return null;

  const rawPset = readText(
    propertyNode.propertySet ??
      propertyNode.PropertySet ??
      propertyNode['ids:propertySet'] ??
      propertyNode['ids:PropertySet']
  );
  const rawBase = readText(
    propertyNode.baseName ??
      propertyNode.BaseName ??
      propertyNode['ids:baseName'] ??
      propertyNode['ids:BaseName']
  );
  const rawName =
    rawBase ??
    readText(
      propertyNode.name ??
        propertyNode.Name ??
        propertyNode['ids:name'] ??
        propertyNode['ids:Name']
    );

  if (!rawPset || !rawName) return null;

  const path = `${normalizeToken(rawPset)}.${normalizeToken(rawName)}`;
  const cardinality = parseCardinality(
    propertyNode.cardinality ?? propertyNode.Cardinality ?? propertyNode['ids:cardinality'],
    propertyNode['@_cardinality'] ?? propertyNode['@_Cardinality']
  );
  const dataTypeAttr =
    (typeof propertyNode['@_dataType'] === 'string' && propertyNode['@_dataType']) ??
    (typeof propertyNode['@_DataType'] === 'string' && propertyNode['@_DataType']) ??
    (typeof propertyNode['@_datatype'] === 'string' && propertyNode['@_datatype']) ??
    (typeof propertyNode.dataType === 'string' && propertyNode.dataType) ??
    (typeof propertyNode.DataType === 'string' && propertyNode.DataType);
  const expected = collectExpectedValues(propertyNode);
  const description = readText(propertyNode.description ?? propertyNode.Description ?? propertyNode['ids:description']);
  return {
    path,
    expected: expected.length ? expected : undefined,
    cardinality,
    description,
    dataType: dataTypeAttr ? dataTypeAttr.trim().toUpperCase() : undefined,
  };
};

const classifyDataType = (token: string | undefined): 'numeric' | 'boolean' | 'string' | 'unknown' => {
  if (!token) return 'unknown';
  const upper = token.trim().toUpperCase();
  if (!upper.length) return 'unknown';
  if (upper === 'IFCBOOLEAN' || upper === 'IFCLOGICAL') return 'boolean';
  if (/(REAL|INTEGER|NUMBER|MEASURE|RATIO|COUNT|AREA|VOLUME|LENGTH|MASS|PRESSURE|POWER|TIME|FREQUENCY|TEMPERATURE|FORCE|MOMENT|THICKNESS|WIDTH|HEIGHT|DEPTH|DENSITY|ENERGY|SPEED|COEFFICIENT|FACTOR|ANGLE)/.test(upper)) {
    return 'numeric';
  }
  if (/(TEXT|LABEL|IDENTIFIER|STRING|URI)/.test(upper)) {
    return 'string';
  }
  return 'unknown';
};

const parseNumericValue = (value: string): number | null => {
  if (!value) return null;
  const normalized = value.replace(/,/g, '.');
  const match = normalized.match(/[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeBooleanValue = (value: string): string | null => {
  const lowered = value.trim().toLowerCase();
  if (!lowered) return null;
  if (['true', 't', 'yes', 'y', '1', 'on'].includes(lowered)) return 'TRUE';
  if (['false', 'f', 'no', 'n', '0', 'off'].includes(lowered)) return 'FALSE';
  return null;
};

const validateDataType = (actual: string, dataType?: string): { ok: boolean; normalized?: string; reason?: string } => {
  const category = classifyDataType(dataType);
  if (category === 'unknown') {
    return { ok: true, normalized: actual };
  }

  if (category === 'numeric') {
    const numeric = parseNumericValue(actual);
    if (numeric === null) {
      return {
        ok: false,
        reason: `Value is not numeric (expected ${dataType}).`,
      };
    }
    return { ok: true, normalized: String(numeric) };
  }

  if (category === 'boolean') {
    const normalized = normalizeBooleanValue(actual);
    if (!normalized) {
      return {
        ok: false,
        reason: `Value is not a valid boolean (expected ${dataType}).`,
      };
    }
    return { ok: true, normalized };
  }

  if (category === 'string') {
    const trimmed = actual.trim();
    if (!trimmed.length) {
      return {
        ok: false,
        reason: `Value is empty (expected ${dataType}).`,
      };
    }
    return { ok: true, normalized: trimmed };
  }

  return { ok: true, normalized: actual };
};

const describeExpectation = (constraint: PropertyConstraint): string | undefined => {
  const parts: string[] = [];
  if (constraint.expected && constraint.expected.length) {
    parts.push(`Values: ${constraint.expected.join(', ')}`);
  }
  if (constraint.dataType) {
    parts.push(`Type: ${constraint.dataType}`);
  }
  if (constraint.cardinality) {
    const max = constraint.cardinality.max === undefined ? '*' : constraint.cardinality.max;
    parts.push(`Cardinality: ${constraint.cardinality.min}:${max}`);
  }
  return parts.length ? parts.join(' | ') : undefined;
};

const parseRule = (spec: any, index: number): CompiledRule | null => {
  const id = readText(spec['@_id'] ?? spec['@_identifier']) ?? `spec-${index + 1}`;
  const title = readText(spec['@_name'] ?? spec.name ?? spec.Name) ?? id;

  const applicability =
    spec.applicability ??
    spec.Applicability ??
    spec['ids:applicability'] ??
    spec['ids:Applicability'];
  const entities = toArray(
    applicability?.entity ??
      applicability?.Entity ??
      applicability?.['ids:entity'] ??
      applicability?.['ids:Entity']
  );
  const ifcClasses = entities
    .map((entity) => {
      const primary = readText(
        entity['@_name'] ??
          entity.name ??
          entity.Name ??
          entity['ids:name'] ??
          entity['ids:Name']
      );
      return normalizeIfcClass(primary ?? readText(entity));
    })
    .filter((entry) => entry.length);

  const requirementCandidates = [
    spec.requirement,
    spec.Requirement,
    spec['ids:requirement'],
    spec.requirements,
    spec.Requirements,
    spec['ids:requirements'],
  ];
  const requirements = requirementCandidates.flatMap((candidate) => toArray(candidate).filter(Boolean));
  const properties: PropertyConstraint[] = [];

  const extractPropertyNodes = (node: any): any[] => {
    if (!node || typeof node !== 'object') return [];
    const propertyArrays = [
      node.property,
      node.Property,
      node['ids:property'],
      node.properties,
      node.Properties,
      node['ids:properties'],
    ];
    const collected = propertyArrays.flatMap((entry) => toArray(entry).filter(Boolean));
    if (collected.length) return collected;
    if (node.propertySet || node.PropertySet || node['ids:propertySet']) {
      return [node];
    }
    return [];
  };

  const pushPropertiesFrom = (node: any) => {
    if (!node || typeof node !== 'object') return;
    extractPropertyNodes(node).forEach((propertyNode) => {
      const constraint = parsePropertyConstraint(propertyNode);
      if (constraint) {
        properties.push(constraint);
      }
    });
    const nestedRequirements = toArray(
      node.requirement ??
        node.Requirement ??
        node['ids:requirement'] ??
        node.requirements ??
        node.Requirements ??
        node['ids:requirements']
    );
    nestedRequirements.forEach((nested) => pushPropertiesFrom(nested));
  };

  if (requirements.length) {
    requirements.forEach((requirement) => {
      pushPropertiesFrom(requirement);
    });
  } else {
    pushPropertiesFrom(spec);
  }

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
  const actualString = actual == null ? '' : typeof actual === 'string' ? actual : String(actual);
  const trimmedActual = actualString.trim();
  if (!trimmedActual.length) {
    if (constraint.cardinality && constraint.cardinality.min > 0) {
        return { status: 'FAILED', reason: 'Property missing', actual: trimmedActual };
    }
    if (!constraint.cardinality) {
      return { status: 'FAILED', reason: 'Property missing', actual: trimmedActual };
    }
  }

  let comparisonValue = trimmedActual;
  if (constraint.dataType && trimmedActual.length) {
    const result = validateDataType(trimmedActual, constraint.dataType);
    if (!result.ok) {
      return {
        status: 'FAILED',
        reason: result.reason,
        actual: trimmedActual,
      };
    }
    if (result.normalized !== undefined) {
      comparisonValue = result.normalized;
    }
  }

  if (constraint.expected && constraint.expected.length) {
    const matches = constraint.expected.some((expected) => expected === comparisonValue);
    if (!matches) {
      return {
        status: 'FAILED',
        reason: `Value does not match expected list (${constraint.expected.join(', ')})`,
        actual: trimmedActual,
      };
    }
  }
  return { status: 'PASSED', actual: trimmedActual };
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
        const expectation = describeExpectation(constraint);
        const baseRow: Omit<DetailRow, 'status'> = {
          ruleId: rule.id,
          ruleTitle: rule.title,
          globalId: element.GlobalId,
          ifcClass: element.ifcClass,
          propertyPath: constraint.path,
          expected: expectation,
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
