/**
 * Universal Adapter Architecture for Pandora
 *
 * This module defines the adapter interfaces that allow any data source
 * in a category (CRM, Conversations, Tasks, Documents) to normalize data
 * to Pandora's unified entity model.
 *
 * Key Principles:
 * - Adapters are stateless: receive credentials per call, no caching
 * - Category-specific interfaces enforce consistent transforms
 * - Write capabilities are opt-in (Tasks only today)
 * - All transforms include source_data JSONB for debugging and custom fields
 */

// ============================================================================
// Core Sync Result Type
// ============================================================================

export interface SyncResult<T> {
  succeeded: T[];
  failed: Array<{
    record: any;
    error: string;
    recordId?: string;
  }>;
  totalAttempted: number;
}

// ============================================================================
// Base Adapter Interface
// ============================================================================

export interface BaseSourceAdapter {
  /**
   * Unique identifier for this adapter (e.g., 'hubspot', 'gong', 'monday')
   */
  readonly sourceType: string;

  /**
   * Category this adapter belongs to: 'crm', 'conversations', 'tasks', 'documents'
   */
  readonly category: 'crm' | 'conversations' | 'tasks' | 'documents';

  /**
   * Test connection using provided credentials
   */
  testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string }>;

  /**
   * Optional: Return health status (rate limits, quota, API status)
   */
  health?(credentials: Record<string, any>): Promise<{
    healthy: boolean;
    details?: Record<string, any>;
  }>;
}

// ============================================================================
// Mixin Interfaces
// ============================================================================

export interface SyncCapable {
  /**
   * Perform initial full sync for a workspace
   */
  initialSync(
    credentials: Record<string, any>,
    workspaceId: string,
    options?: Record<string, any>
  ): Promise<{
    deals?: SyncResult<NormalizedDeal>;
    contacts?: SyncResult<NormalizedContact>;
    accounts?: SyncResult<NormalizedAccount>;
    conversations?: SyncResult<NormalizedConversation>;
    tasks?: SyncResult<NormalizedTask>;
    documents?: SyncResult<NormalizedDocument>;
  }>;

  /**
   * Perform incremental sync (changes since lastSyncTime)
   */
  incrementalSync(
    credentials: Record<string, any>,
    workspaceId: string,
    lastSyncTime: Date,
    options?: Record<string, any>
  ): Promise<{
    deals?: SyncResult<NormalizedDeal>;
    contacts?: SyncResult<NormalizedContact>;
    accounts?: SyncResult<NormalizedAccount>;
    conversations?: SyncResult<NormalizedConversation>;
    tasks?: SyncResult<NormalizedTask>;
    documents?: SyncResult<NormalizedDocument>;
  }>;

  /**
   * Optional: Backfill historical data (date range)
   */
  backfillSync?(
    credentials: Record<string, any>,
    workspaceId: string,
    startDate: Date,
    endDate: Date,
    options?: Record<string, any>
  ): Promise<{
    deals?: SyncResult<NormalizedDeal>;
    contacts?: SyncResult<NormalizedContact>;
    accounts?: SyncResult<NormalizedAccount>;
    conversations?: SyncResult<NormalizedConversation>;
    tasks?: SyncResult<NormalizedTask>;
    documents?: SyncResult<NormalizedDocument>;
  }>;
}

export interface SchemaDiscoverable {
  /**
   * Discover available custom fields from the source system
   */
  discoverSchema(credentials: Record<string, any>): Promise<{
    customFields: Array<{
      key: string;
      label: string;
      type: 'string' | 'number' | 'date' | 'boolean' | 'array';
      category: 'deal' | 'contact' | 'account' | 'conversation' | 'task' | 'document';
    }>;
  }>;

  /**
   * Suggest field mappings between source and Pandora schema
   */
  proposeMapping?(
    credentials: Record<string, any>
  ): Promise<{
    mappings: Array<{
      sourceField: string;
      pandoraField: string;
      confidence: number;
    }>;
  }>;
}

// ============================================================================
// Normalized Entity Types (Match Database Schema)
// ============================================================================

export interface NormalizedDeal {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  name: string | null;
  amount: number | null;
  stage: string | null;
  close_date: string | null;
  owner: string | null;
  probability: number | null;
  forecast_category: string | null;
  pipeline: string | null;
  last_activity_date: Date | null;
  custom_fields: Record<string, any>;
}

export interface NormalizedContact {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  lifecycle_stage: string | null;
  engagement_score: number | null;
  phone: string | null;
  last_activity_date: Date | null;
  custom_fields: Record<string, any>;
}

export interface NormalizedAccount {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  name: string | null;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  owner: string | null;
  custom_fields: Record<string, any>;
}

export interface NormalizedConversation {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  call_date: Date | null;
  duration_seconds: number | null;
  participants: any[];
  transcript_text: string | null;
  summary: string | null;
  action_items: any[];
  objections: any[];
  sentiment_score: number | null;
  talk_listen_ratio: any | null;
  topics: any[];
  competitor_mentions: any[];
  custom_fields: Record<string, any>;
}

export interface NormalizedTask {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  title: string | null;
  description: string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  assignee: string | null;
  due_date: Date | null;
  completed_date: Date | null;
  tags: string[];
  custom_fields: Record<string, any>;
}

export interface NormalizedDocument {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  title: string | null;
  file_type: string | null;
  url: string | null;
  size_bytes: number | null;
  owner: string | null;
  created_date: Date | null;
  modified_date: Date | null;
  content_text: string | null;
  tags: string[];
  custom_fields: Record<string, any>;
}

// ============================================================================
// Category-Specific Adapter Interfaces
// ============================================================================

/**
 * CRM Adapter: Normalizes CRM data to Deal, Contact, Account entities
 * Examples: HubSpot, Salesforce, Pipedrive
 */
export interface CRMAdapter extends BaseSourceAdapter, SyncCapable, SchemaDiscoverable {
  readonly category: 'crm';

  /**
   * Transform raw CRM deal to normalized format
   */
  transformDeal(raw: any, workspaceId: string, options?: any): NormalizedDeal;

  /**
   * Transform raw CRM contact to normalized format
   */
  transformContact(raw: any, workspaceId: string, options?: any): NormalizedContact;

  /**
   * Transform raw CRM account/company to normalized format
   */
  transformAccount(raw: any, workspaceId: string, options?: any): NormalizedAccount;
}

/**
 * Conversation Adapter: Normalizes conversation intelligence data
 * Examples: Gong, Fireflies, Fathom, Zoom AI
 */
export interface ConversationAdapter extends BaseSourceAdapter, SyncCapable {
  readonly category: 'conversations';

  /**
   * Transform raw call/meeting data to normalized conversation
   */
  transformConversation(raw: any, workspaceId: string, options?: any): NormalizedConversation;
}

/**
 * Task Adapter: Normalizes task/project management data
 * Examples: Monday.com, Asana, Linear, Jira
 *
 * Special: Tasks support WRITE operations (create, update, complete)
 */
export interface TaskAdapter extends BaseSourceAdapter, SyncCapable {
  readonly category: 'tasks';

  /**
   * Whether this adapter supports creating/updating tasks in the source system
   */
  readonly supportsWrite: boolean;

  /**
   * Transform raw task data to normalized format
   */
  transformTask(raw: any, workspaceId: string, options?: any): NormalizedTask;

  /**
   * Create a new task in the source system (if supportsWrite is true)
   */
  createTask?(
    credentials: Record<string, any>,
    workspaceId: string,
    task: TaskCreateInput,
    context?: TaskContext
  ): Promise<{ success: boolean; sourceId?: string; error?: string }>;

  /**
   * Update an existing task in the source system (if supportsWrite is true)
   */
  updateTask?(
    credentials: Record<string, any>,
    workspaceId: string,
    sourceId: string,
    updates: TaskUpdateInput
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Mark a task as completed (if supportsWrite is true)
   */
  completeTask?(
    credentials: Record<string, any>,
    workspaceId: string,
    sourceId: string
  ): Promise<{ success: boolean; error?: string }>;
}

/**
 * Document Adapter: Normalizes document storage/collaboration data
 * Examples: Google Drive, Notion, SharePoint
 */
export interface DocumentAdapter extends BaseSourceAdapter, SyncCapable {
  readonly category: 'documents';

  /**
   * Transform raw document metadata to normalized format
   */
  transformDocument(raw: any, workspaceId: string, options?: any): NormalizedDocument;

  /**
   * Extract text content from document (optional - may be async/expensive)
   */
  extractContent?(
    credentials: Record<string, any>,
    sourceId: string
  ): Promise<{ text: string | null; error?: string }>;
}

// ============================================================================
// Task Write Operation Types
// ============================================================================

export interface TaskCreateInput {
  title: string;
  description?: string;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assignee?: string;
  due_date?: Date;
  tags?: string[];
  custom_fields?: Record<string, any>;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assignee?: string;
  due_date?: Date;
  tags?: string[];
  custom_fields?: Record<string, any>;
}

export interface TaskContext {
  /**
   * Context for task hierarchy (e.g., Monday board/group structure)
   */
  engagement?: string;
  phase?: string;
  milestone?: string;
  board_id?: string;
  group_id?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isCRMAdapter(adapter: BaseSourceAdapter): adapter is CRMAdapter {
  return adapter.category === 'crm';
}

export function isConversationAdapter(adapter: BaseSourceAdapter): adapter is ConversationAdapter {
  return adapter.category === 'conversations';
}

export function isTaskAdapter(adapter: BaseSourceAdapter): adapter is TaskAdapter {
  return adapter.category === 'tasks';
}

export function isDocumentAdapter(adapter: BaseSourceAdapter): adapter is DocumentAdapter {
  return adapter.category === 'documents';
}
