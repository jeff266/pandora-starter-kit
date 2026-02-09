/**
 * Adapter Registry
 *
 * Central registry for all data source adapters in Pandora.
 * Allows lookup by source type ('hubspot', 'gong', 'monday') or by category ('crm', 'conversations', etc.).
 *
 * Usage:
 *   const registry = AdapterRegistry.getInstance();
 *   registry.register(hubspotAdapter);
 *   const adapter = registry.get('hubspot');
 *   const crmAdapters = registry.getByCategory('crm');
 */

import type {
  BaseSourceAdapter,
  CRMAdapter,
  ConversationAdapter,
  TaskAdapter,
  DocumentAdapter,
} from './types.js';

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters: Map<string, BaseSourceAdapter> = new Map();

  private constructor() {}

  /**
   * Get singleton instance of the registry
   */
  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Register an adapter
   * @throws Error if an adapter with the same sourceType is already registered
   */
  register(adapter: BaseSourceAdapter): void {
    if (this.adapters.has(adapter.sourceType)) {
      throw new Error(`Adapter with sourceType '${adapter.sourceType}' is already registered`);
    }
    this.adapters.set(adapter.sourceType, adapter);
    console.log(`[AdapterRegistry] Registered ${adapter.category} adapter: ${adapter.sourceType}`);
  }

  /**
   * Get an adapter by source type
   * @returns The adapter, or undefined if not found
   */
  get(sourceType: string): BaseSourceAdapter | undefined {
    return this.adapters.get(sourceType);
  }

  /**
   * Get all adapters in a specific category
   */
  getByCategory(category: 'crm' | 'conversations' | 'tasks' | 'documents'): BaseSourceAdapter[] {
    return Array.from(this.adapters.values()).filter((adapter) => adapter.category === category);
  }

  /**
   * Get all CRM adapters
   */
  getCRMAdapters(): CRMAdapter[] {
    return this.getByCategory('crm') as CRMAdapter[];
  }

  /**
   * Get all Conversation adapters
   */
  getConversationAdapters(): ConversationAdapter[] {
    return this.getByCategory('conversations') as ConversationAdapter[];
  }

  /**
   * Get all Task adapters
   */
  getTaskAdapters(): TaskAdapter[] {
    return this.getByCategory('tasks') as TaskAdapter[];
  }

  /**
   * Get all Document adapters
   */
  getDocumentAdapters(): DocumentAdapter[] {
    return this.getByCategory('documents') as DocumentAdapter[];
  }

  /**
   * List all registered source types
   */
  listSourceTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Check if a source type is registered
   */
  has(sourceType: string): boolean {
    return this.adapters.has(sourceType);
  }

  /**
   * Unregister an adapter (primarily for testing)
   */
  unregister(sourceType: string): boolean {
    return this.adapters.delete(sourceType);
  }

  /**
   * Clear all adapters (primarily for testing)
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number;
    byCategory: Record<string, number>;
    sourceTypes: string[];
  } {
    const byCategory: Record<string, number> = {
      crm: 0,
      conversations: 0,
      tasks: 0,
      documents: 0,
    };

    for (const adapter of this.adapters.values()) {
      byCategory[adapter.category]++;
    }

    return {
      total: this.adapters.size,
      byCategory,
      sourceTypes: this.listSourceTypes(),
    };
  }
}

/**
 * Convenience function to get the singleton instance
 */
export function getAdapterRegistry(): AdapterRegistry {
  return AdapterRegistry.getInstance();
}
