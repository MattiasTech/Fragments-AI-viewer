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
};

export type ElementData = {
  GlobalId: string;
  ifcClass: string;
  properties: Record<string, unknown>;
};

export interface ViewerApi {
  listGlobalIds(): Promise<string[]>;
  getElementProps(globalId: string): Promise<{
    ifcClass: string;
    psets: Record<string, Record<string, unknown>>;
    attributes?: Record<string, unknown>;
  }>;
  isolate(globalIds: string[]): Promise<void> | void;
  color(globalIds: string[], rgba: RgbaColor): Promise<void> | void;
  clearColors(): Promise<void> | void;
  fitViewTo(globalIds: string[]): Promise<void> | void;
  clearIsolation(): Promise<void> | void;
  countElements(): Promise<number>;
  iterElements(options?: { batchSize?: number }): AsyncIterable<
    Array<{
      modelId: string;
      localId: number;
      data: Record<string, unknown>;
    }>
  >;
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
