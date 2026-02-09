export interface ConnectorCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  instanceUrl?: string;
  [key: string]: any;
}

export interface Connection {
  id: string;
  workspaceId: string;
  connectorName: string;
  status: 'healthy' | 'degraded' | 'error' | 'disconnected';
  credentials: ConnectorCredentials;
  metadata?: Record<string, any>;
}

export interface SourceSchema {
  objectTypes: ObjectTypeSchema[];
}

export interface ObjectTypeSchema {
  name: string;
  fields: FieldSchema[];
}

export interface FieldSchema {
  name: string;
  label: string;
  type: string;
  required: boolean;
  custom: boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  objectType: string;
  transformationType?: 'direct' | 'computed' | 'lookup' | 'custom';
  transformationLogic?: string;
}

export interface RawRecord {
  id: string;
  objectType: string;
  data: Record<string, any>;
  associations?: Record<string, string[]>;
  sourceTimestamp?: Date;
}

export interface ConnectorHealth {
  status: 'healthy' | 'degraded' | 'error' | 'disconnected';
  lastSync?: Date;
  recordsSynced?: number;
  errors?: Array<{
    timestamp: Date;
    message: string;
    code?: string;
  }>;
  rateLimitStatus?: {
    remaining: number;
    resetAt: Date;
  };
}

export interface SyncResult {
  recordsFetched: number;
  recordsStored: number;
  errors: string[];
  duration: number;
}

export interface PandoraConnector {
  readonly name: string;
  readonly category: 'crm' | 'conversations' | 'operations' | 'documents';
  readonly authMethod: 'oauth' | 'api_key' | 'basic';

  testConnection(credentials: ConnectorCredentials): Promise<{ success: boolean; error?: string; accountInfo?: any }>;
  connect(credentials: ConnectorCredentials, workspaceId: string): Promise<Connection>;
  disconnect(workspaceId: string): Promise<void>;

  discoverSchema?(connection: Connection): Promise<SourceSchema>;
  proposeMapping?(schema: SourceSchema): Promise<FieldMapping[]>;

  initialSync(connection: Connection, workspaceId: string): Promise<SyncResult>;
  incrementalSync(connection: Connection, workspaceId: string, since: Date): Promise<SyncResult>;
  backfillSync?(connection: Connection, workspaceId: string): Promise<SyncResult>;

  health(workspaceId: string): Promise<ConnectorHealth>;
}
