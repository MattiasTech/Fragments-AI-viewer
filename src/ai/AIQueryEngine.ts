import { ViewerApi, ElementData } from '../ids/ids.types';
import { collectElementsForIds } from '../ids/ids.adapter';

export class AIQueryEngine {
  private static instance: AIQueryEngine;
  private viewerApi: ViewerApi | null = null;
  private elements: ElementData[] = [];
  private indices = {
    byCategory: new Map<string, ElementData[]>(),
    byGlobalId: new Map<string, ElementData>(),
    // Simple text index: word -> Set<GlobalId>
    searchIndex: new Map<string, Set<string>>(), 
  };
  private isIndexing = false;
  private isReady = false;

  private constructor() {}

  static getInstance(): AIQueryEngine {
    if (!AIQueryEngine.instance) {
      AIQueryEngine.instance = new AIQueryEngine();
    }
    return AIQueryEngine.instance;
  }

  setViewerApi(api: ViewerApi) {
    this.viewerApi = api;
  }

  /**
   * Start indexing the model data.
   * This should be called when a model is loaded.
   */
  async indexModel(forceRefresh = false) {
    if (!this.viewerApi) {
      console.warn('AIQueryEngine: ViewerApi not set');
      return;
    }
    if (this.isIndexing) return;

    try {
      this.isIndexing = true;
      console.log('AIQueryEngine: Starting indexing...');

      // Reuse the existing IDS collection logic which handles workers and caching!
      // This satisfies the requirement to index information and build property cache.
      const elements = await collectElementsForIds(this.viewerApi);
      
      this.elements = elements;
      this.buildIndices(elements);
      
      this.isReady = true;
      console.log(`AIQueryEngine: Indexed ${elements.length} elements.`);
    } catch (error) {
      console.error('AIQueryEngine: Indexing failed', error);
    } finally {
      this.isIndexing = false;
    }
  }

  private buildIndices(elements: ElementData[]) {
    this.indices.byCategory.clear();
    this.indices.byGlobalId.clear();
    this.indices.searchIndex.clear();

    for (const el of elements) {
      // Index by Category
      const cat = el.ifcClass.toUpperCase();
      if (!this.indices.byCategory.has(cat)) {
        this.indices.byCategory.set(cat, []);
      }
      this.indices.byCategory.get(cat)!.push(el);

      // Index by GlobalId
      this.indices.byGlobalId.set(el.GlobalId, el);

      // Simple full-text index on properties
      // Tokenize values
      const tokens = new Set<string>();
      
      // Helper to add tokens
      const addTokens = (val: unknown) => {
        if (!val) return;
        const str = String(val).toLowerCase();
        // Split by non-alphanumeric
        str.split(/[^a-z0-9]+/g).forEach(t => {
          if (t.length > 2) tokens.add(t);
        });
      };

      // Add category
      addTokens(el.ifcClass);
      
      // Add properties
      if (el.properties) {
        // properties is Record<string, unknown> or Record<string, Record<string, unknown>>?
        // In ElementData it's Record<string, unknown> (flattened Pset.Prop)
        for (const [key, val] of Object.entries(el.properties)) {
           addTokens(val);
           // Also add property name parts if useful, maybe too noisy
        }
      }

      for (const token of tokens) {
        if (!this.indices.searchIndex.has(token)) {
          this.indices.searchIndex.set(token, new Set());
        }
        this.indices.searchIndex.get(token)!.add(el.GlobalId);
      }
    }
  }

  /**
   * Search for elements based on a natural language query (conceptually).
   * Currently implements keyword search.
   */
  search(query: string): ElementData[] {
    if (!query) return [];
    const tokens = query.toLowerCase().split(/[^a-z0-9]+/g).filter(t => t.length > 2);
    if (tokens.length === 0) return [];

    // Find intersection of all tokens
    let resultIds: Set<string> | null = null;

    for (const token of tokens) {
      const match = this.indices.searchIndex.get(token);
      if (!match) {
        // If any token has no matches, result is empty (AND logic)
        // Or we could try partial matches? Let's stick to exact logic for now or 'OR' logic?
        // Let's do partial match on keys
        let subMatch = new Set<string>();
        for (const [key, ids] of this.indices.searchIndex.entries()) {
            if (key.includes(token)) {
                for (const id of ids) subMatch.add(id);
            }
        }
        if (subMatch.size === 0) return []; // No matches for this token
        
        if (resultIds === null) {
            resultIds = subMatch;
        } else {
            // Intersection
            const previousResult: Set<string> = resultIds;
            resultIds = new Set([...previousResult].filter((x: string) => subMatch.has(x)));
        }
      } else {
        if (resultIds === null) {
          resultIds = new Set(match);
        } else {
          const previousResult: Set<string> = resultIds;
          resultIds = new Set([...previousResult].filter((x: string) => match.has(x)));
        }
      }
    }

    if (!resultIds || resultIds.size === 0) return [];

    return Array.from(resultIds).map(id => this.indices.byGlobalId.get(id)!).filter(Boolean);
  }

  /**
   * Generate context for the AI based on the user's question.
   * This aims to provide relevant info without overloading the context.
   */
  async generateContext(question: string, activeSelection?: { modelId: string, localId: number }[]): Promise<string> {
    if (!this.isReady && !this.isIndexing) {
      await this.indexModel(); // Try to auto-index if not ready
    }

    const lines: string[] = [];
    
    // 1. General Stats
    const total = this.elements.length;
    const catStats = Array.from(this.indices.byCategory.entries())
      .map(([cat, list]) => `${cat}: ${list.length}`)
      .sort()
      .join(', ');

    lines.push(`Total Elements: ${total}`);
    lines.push(`Categories: ${catStats}`);

    // 2. Active Selection (Highest Priority)
    if (activeSelection && activeSelection.length > 0) {
        lines.push(`\n--- Active Selection (${activeSelection.length}) ---`);
        // We need to map selection to GlobalIds. 
        // We don't have localId -> GlobalId map easily here unless we query viewerApi or if ElementData has it.
        // ElementData has GlobalId. ViewerApi has conversion methods usually.
        // But collecting props for selection is handled in App.tsx currently.
        // We can skip this here and let App.tsx append selection info, OR we improve it.
        // Let's assume App.tsx appends selection detail as it did before, we just provide GLOBAL context.
    }

    // 3. Keyword Search Relevance
    // If the user asks about specific things (e.g. "Window", "Door", "FireRating"), filter.
    const searchResults = this.search(question);
    
    // Heuristic: If search returns a subset (e.g. < 50 items), assume the user is asking about them.
    // If it returns too many, maybe just summarize them.
    
    if (searchResults.length > 0 && searchResults.length < 50) {
        lines.push(`\n--- Relevant Elements based on your query (${searchResults.length}) ---`);
        for (const el of searchResults) {
            lines.push(`- ${el.ifcClass} [${el.GlobalId}]`);
            // Show some properties?
            lines.push(`  Properties: ${JSON.stringify(el.properties).slice(0, 300)}...`);
        }
    } else if (searchResults.length >= 50) {
       lines.push(`\n--- Found ${searchResults.length} elements matching your keywords ---`);
       // Group by category
       const searchByCat = new Map<string, number>();
       searchResults.forEach(el => searchByCat.set(el.ifcClass, (searchByCat.get(el.ifcClass) || 0) + 1));
       lines.push(`Matching categories: ${Array.from(searchByCat.entries()).map(e => `${e[0]}: ${e[1]}`).join(', ')}`);
    }

    // 4. Handle "Category" specific questions (e.g. "How many walls?")
    // Iterate known categories
    for (const [cat, list] of this.indices.byCategory.entries()) {
        if (question.toUpperCase().includes(cat) || question.toUpperCase().includes(cat.replace('IFC', ''))) {
             if (list.length > 20) {
                 lines.push(`\n--- ${cat} Summary ---`);
                 lines.push(`${cat} count: ${list.length}`);
                 lines.push(`Sample element: ${JSON.stringify(list[0].properties).slice(0, 200)}...`);
             } else {
                 lines.push(`\n--- ${cat} Details ---`);
                 list.forEach(el => {
                     lines.push(`${cat} [${el.GlobalId}]: ${JSON.stringify(el.properties)}`);
                 });
             }
        }
    }

    return lines.join('\n');
  }

  isReadyStatus() {
    return this.isReady;
  }
}
