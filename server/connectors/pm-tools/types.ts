/**
 * PM Tool Integration Types
 *
 * Defines the universal interface for pushing RevOps operator work items
 * to project management tools (Monday, Asana, Linear, Jira, ClickUp).
 */

/**
 * Universal adapter interface for PM tools
 * All PM connectors implement this interface
 */
export interface PandoraTaskAdapter {
  readonly connectorType: string;  // 'monday', 'asana', 'linear', 'jira', 'clickup'

  // Connection
  testConnection(credentials: Record<string, any>): Promise<{ success: boolean; error?: string; accountInfo?: any }>;

  // Discovery — find where RevOps tasks should go
  listProjects(credentials: Record<string, any>): Promise<{ id: string; name: string }[]>;
  listSections(credentials: Record<string, any>, projectId: string): Promise<{ id: string; name: string }[]>;
  listUsers(credentials: Record<string, any>): Promise<{ id: string; name: string; email: string }[]>;

  // CRUD
  createTask(credentials: Record<string, any>, task: OpsWorkItem): Promise<{ externalId: string; url: string }>;
  updateTask(credentials: Record<string, any>, externalId: string, updates: Partial<OpsWorkItem>): Promise<void>;
  completeTask(credentials: Record<string, any>, externalId: string): Promise<void>;

  // Goals (optional — Asana, ClickUp)
  updateGoalProgress?(credentials: Record<string, any>, goalId: string, value: number): Promise<void>;
}

/**
 * Category of ops work item
 */
export type OpsCategory =
  | 'process_fix'           // Sales process needs updating
  | 'system_config'         // CRM/tool configuration change needed
  | 'data_cleanup'          // Bulk data fix or validation rule
  | 'methodology_review'    // Forecast/qualification criteria need review
  | 'enablement_gap'        // Training or playbook needed
  | 'territory_planning'    // Territory/capacity rebalancing needed
  | 'reporting_request'     // Dashboard or report to build
  | 'gtm_strategy';         // Strategic recommendation from ICP/CI data

/**
 * Priority level for work items
 */
export type OpsPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * RevOps operator work item
 * Created by Pandora skills and pushed to PM tools
 */
export interface OpsWorkItem {
  name: string;                       // "Build required field validation for close date"
  description: string;                // Markdown: context, data points, recommended approach
  category: OpsCategory;
  priority: OpsPriority;
  dueDate?: string;                   // ISO date
  assigneeEmail?: string;             // RevOps team member (not sales rep)
  labels?: string[];                  // ['pipeline-hygiene', 'data-quality', 'q1-cleanup']
  projectId?: string;                 // Target project/board in PM tool
  sectionId?: string;                 // Target section/group/column

  // Pandora context
  sourceActionId?: string;
  sourceSkill: string;                // 'pipeline-hygiene', 'data-quality-audit', etc.
  findingSummary: string;             // "47 deals missing close dates in Q1 pipeline"
  impactMetric?: string;              // "$2.3M pipeline affected" or "23% fill rate"
  recommendedApproach?: string;       // "Configure HubSpot workflow to require field..."
  affectedRecordCount?: number;       // 47
  dataPoints?: Record<string, any>;   // Structured data from skill output for reference
}

/**
 * Result of PM task creation
 */
export interface PMTaskCreationResult {
  success: boolean;
  externalId?: string;     // Task ID in PM tool
  url?: string;            // Direct link to task in PM tool
  error?: string;
}

/**
 * PM connector configuration stored in workspace settings
 */
export interface PMConnectorConfig {
  connectorType: 'monday' | 'asana' | 'linear' | 'jira' | 'clickup';
  enabled: boolean;
  defaultProjectId?: string;        // Default board/project for tasks
  defaultSectionId?: string;        // Default group/section/list
  categoryMapping?: Record<OpsCategory, string>; // Map category to PM-tool section/label
  userMapping?: Record<string, string>;          // Map RevOps email → PM tool user ID
  labels?: string[];                             // Default labels to apply
}
