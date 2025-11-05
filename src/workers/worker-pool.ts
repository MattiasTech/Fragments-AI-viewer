/**
 * Worker pool manager for parallel IDS property extraction
 */

import type { WorkerElementData, WorkerRequest, WorkerResponse, WorkerError, ProcessedElement } from './ids-properties.worker';

export interface WorkerPoolOptions {
  workerCount?: number; // Number of workers (default: navigator.hardwareConcurrency - 1)
  batchSize?: number; // Elements per batch (default: 500)
  onProgress?: (completed: number, total: number) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private activeWorkers = 0;
  private completedBatches = 0;
  private totalBatches = 0;
  private results: Map<number, ProcessedElement[]> = new Map();
  private pendingBatches: Array<{ batchId: number; elements: WorkerElementData[] }> = [];
  private onProgress?: (completed: number, total: number) => void;
  
  constructor(
    private workerCount: number,
    private batchSize: number,
    onProgress?: (completed: number, total: number) => void
  ) {
    this.onProgress = onProgress;
  }
  
  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    const workerUrl = new URL('./ids-properties.worker.ts', import.meta.url);
    
    for (let i = 0; i < this.workerCount; i++) {
      try {
        const worker = new Worker(workerUrl, { type: 'module' });
        
        // Wait for worker to be ready
        await new Promise<void>((resolve) => {
          const readyHandler = (event: MessageEvent) => {
            if (event.data.type === 'ready') {
              worker.removeEventListener('message', readyHandler);
              resolve();
            }
          };
          worker.addEventListener('message', readyHandler);
        });
        
        this.workers.push(worker);
      } catch (error) {
        console.error(`Failed to create worker ${i}:`, error);
      }
    }
    
  }
  
  /**
   * Process elements in parallel using the worker pool
   */
  async processElements(elements: WorkerElementData[]): Promise<ProcessedElement[]> {
    if (this.workers.length === 0) {
      throw new Error('Worker pool not initialized');
    }
    
    // Split elements into batches
    this.pendingBatches = [];
    for (let i = 0; i < elements.length; i += this.batchSize) {
      const batch = elements.slice(i, i + this.batchSize);
      this.pendingBatches.push({
        batchId: this.pendingBatches.length,
        elements: batch
      });
    }
    
    this.totalBatches = this.pendingBatches.length;
    this.completedBatches = 0;
    this.results.clear();
    
    
    // Start processing
    const promise = new Promise<ProcessedElement[]>((resolve, reject) => {
      let hasError = false;
      
      const handleMessage = (workerId: number) => (event: MessageEvent<WorkerResponse | WorkerError>) => {
        const message = event.data;
        
        if (message.type === 'batch-complete') {
          this.results.set(message.batchId, message.results);
          this.completedBatches++;
          
          // Report progress
          if (this.onProgress) {
            this.onProgress(this.completedBatches, this.totalBatches);
          }
          
          // Check if all batches are complete
          if (this.completedBatches === this.totalBatches) {
            // Aggregate results in correct order
            const allResults: ProcessedElement[] = [];
            for (let i = 0; i < this.totalBatches; i++) {
              const batchResults = this.results.get(i);
              if (batchResults) {
                allResults.push(...batchResults);
              }
            }
            
            resolve(allResults);
          } else {
            // Send next batch to this worker
            this.sendNextBatch(workerId);
          }
        } else if (message.type === 'error') {
          hasError = true;
          console.error(`Worker ${workerId} error on batch ${message.batchId}:`, message.error);
          reject(new Error(message.error));
        }
      };
      
      const handleError = (workerId: number) => (error: ErrorEvent) => {
        hasError = true;
        console.error(`Worker ${workerId} encountered an error:`, error);
        reject(error);
      };
      
      // Attach handlers and send initial batches
      this.workers.forEach((worker, index) => {
        worker.addEventListener('message', handleMessage(index));
        worker.addEventListener('error', handleError(index));
        
        // Send first batch to each worker
        this.sendNextBatch(index);
      });
    });
    
    return promise;
  }
  
  /**
   * Send next batch to a worker
   */
  private sendNextBatch(workerId: number): void {
    if (this.pendingBatches.length === 0) {
      return;
    }
    
    const batch = this.pendingBatches.shift();
    if (!batch) return;
    
    const worker = this.workers[workerId];
    if (!worker) return;
    
    const request: WorkerRequest = {
      type: 'process-batch',
      batchId: batch.batchId,
      elements: batch.elements
    };
    
    worker.postMessage(request);
  }
  
  /**
   * Terminate all workers
   */
  terminate(): void {
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
  }
}

/**
 * Create and initialize a worker pool
 */
export async function createWorkerPool(options: WorkerPoolOptions = {}): Promise<WorkerPool> {
  const workerCount = options.workerCount ?? Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const batchSize = options.batchSize ?? 500;
  
  const pool = new WorkerPool(workerCount, batchSize, options.onProgress);
  await pool.initialize();
  
  return pool;
}
