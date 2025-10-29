export type Phase =
  | 'IDLE'
  | 'BUILDING_PROPERTIES'
  | 'CHECKING_IDS'
  | 'COMPARING_DATA'
  | 'FINALIZING'
  | 'DONE'
  | 'ERROR';

export type BuildProgress = {
  done: number;
  total: number;
  // Optional property-level progress: number of flattened property entries processed
  propertiesDone?: number;
  propertiesTotal?: number;
};

export type ElementData = {
  GlobalId: string;
  ifcClass: string;
  properties: Record<string, unknown>;
};

export type IdsSpecification = {
  id: string;
  name: string;
  description: string;
  applicability: unknown[];
  // requirements can be either legacy snapshots or structured rules
  requirements: Array<RequirementRule | unknown>;
};

export type RequirementOperator = 'exists' | 'equals' | 'not-equals' | 'contains' | 'matches' | 'greater-than' | 'less-than';

export type RequirementRule = {
  id: string;
  propertyPath: string; // e.g. 'Pset_Insulation.ThermalResistance'
  operator: RequirementOperator;
  value?: string; // stringified comparison value
  sample?: Record<string, unknown> | null; // optional provenance
};

export type ItemsDataRelationConfig = {
  attributes?: boolean;
  relations?: boolean;
};

export type ItemsDataConfig = {
  attributesDefault?: boolean;
  attributes?: string[];
  relationsDefault?: ItemsDataRelationConfig;
  relations?: Record<string, ItemsDataRelationConfig>;
};

export type ItemData = {
  _localId: { value: number };
  _category: { value: string };
  GlobalId?: { value: string };
  Name?: { value: string };
  [key: string]: any;
};

export interface ViewerApi {
  listGlobalIds(): Promise<string[]>;
  getSelectedGlobalIds?(): Promise<string[]>; // Optional: Get only selected elements
  getVisibleGlobalIds?(): Promise<string[]>; // Optional: Get only visible elements
  getElementProps(globalId: string): Promise<{
    ifcClass: string;
    psets: Record<string, Record<string, unknown>>;
    attributes?: Record<string, unknown>;
  }>;
  getElementPropsFast?(globalId: string): Promise<{ // Fast path that doesn't require full cache
    ifcClass: string;
    psets: Record<string, Record<string, unknown>>;
    attributes?: Record<string, unknown>;
  }>;
  addToCache?(globalIds: string[]): Promise<void>; // Add elements to cache incrementally
  selectGlobalIds?(globalIds: string[]): Promise<void> | void; // Select elements in the viewer by GlobalId
  isolate(globalIds: string[]): Promise<void> | void;
  ghost?(globalIds: string[]): Promise<void> | void; // Make non-matching elements transparent
  color(globalIds: string[], rgba: RgbaColor): Promise<void> | void;
  clearColors(): Promise<void> | void;
  fitViewTo(globalIds: string[]): Promise<void> | void;
  clearIsolation(): Promise<void> | void;
  countElements(): Promise<number>;
  // On-demand property loading (ThatOpen pattern)
  getItemsData?(globalIds: string[], config?: ItemsDataConfig): Promise<ItemData[]>;
  getItemsByCategory?(categories: RegExp[]): Promise<Record<string, number[]>>;
  getItemsDataByModel?(modelId: string, localIds: number[], config?: ItemsDataConfig): Promise<ItemData[]>;
  iterElements(options?: { batchSize?: number }): AsyncIterable<
    Array<{
      modelId: string;
      localId: number;
      data: Record<string, unknown>;
    }>
  >;
  getModelSignature?(): Promise<{
    signature: string;
    elementCount: number;
    modelFiles: Array<{ id: string; name: string }>;
  }>;
}

export type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type RuleResult = {
  id: string;
  title: string;
  passed: string[];
  failed: string[];
  na: string[];
};

export type DetailRow = {
  ruleId: string;
  ruleTitle: string;
  globalId: string;
  ifcClass?: string;
  propertyPath?: string;
  expected?: string;
  actual?: string;
  reason?: string;
  status: 'PASSED' | 'FAILED' | 'NA';
};

export type IdsValidateRequest = {
  type: 'validate';
  idsXml: string;
  elements: ElementData[];
  chunk?: number;
};

export type IdsCancelRequest = {
  type: 'cancel';
};

export type IdsWorkerMessage = IdsValidateRequest | IdsCancelRequest;

export type IdsPhaseMessage = { type: 'phase'; label: 'compiling' | 'validating' | 'finalizing' | 'idle' };
export type IdsProgressMessage = { type: 'progress'; done: number; total: number };
export type IdsDoneMessage = { type: 'done'; rules: RuleResult[]; rows: DetailRow[] };
export type IdsErrorMessage = { type: 'error'; message: string };

export type IdsWorkerResponse = IdsPhaseMessage | IdsProgressMessage | IdsDoneMessage | IdsErrorMessage;

export type IdsFilterPredicate = (row: DetailRow) => boolean;

export type IdsDocumentSource = {
  name: string;
  content: string;
};
