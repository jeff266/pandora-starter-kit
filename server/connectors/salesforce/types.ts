/**
 * Salesforce API Types
 *
 * Type definitions for Salesforce REST API v59.0 responses
 */

// ============================================================================
// Salesforce Objects
// ============================================================================

export interface SalesforceOpportunity {
  Id: string;
  Name: string;
  Amount: number | null;
  StageName: string;
  CloseDate: string;              // YYYY-MM-DD
  Probability: number | null;
  ForecastCategoryName: string | null; // Omitted, Pipeline, Best Case, Commit, Closed
  OwnerId: string;
  Owner?: { Name: string; Email: string };
  AccountId: string | null;
  Account?: { Name: string };
  Type: string | null;
  LeadSource: string | null;
  IsClosed: boolean;
  IsWon: boolean;
  Description: string | null;
  NextStep: string | null;
  CreatedDate: string;            // ISO datetime
  LastModifiedDate: string;
  SystemModstamp: string;
  // Custom fields come through as dynamic keys
  [key: string]: unknown;
}

export interface SalesforceContact {
  Id: string;
  FirstName: string | null;
  LastName: string;
  Email: string | null;
  Phone: string | null;
  Title: string | null;
  Department: string | null;
  AccountId: string | null;
  Account?: { Name: string };
  OwnerId: string;
  Owner?: { Name: string; Email: string };
  LeadSource: string | null;
  CreatedDate: string;
  LastModifiedDate: string;
  SystemModstamp: string;
  [key: string]: unknown;
}

export interface SalesforceAccount {
  Id: string;
  Name: string;
  Website: string | null;         // Maps to domain
  Industry: string | null;
  NumberOfEmployees: number | null;
  AnnualRevenue: number | null;
  OwnerId: string;
  Owner?: { Name: string; Email: string };
  BillingCity: string | null;
  BillingState: string | null;
  BillingCountry: string | null;
  Type: string | null;
  CreatedDate: string;
  LastModifiedDate: string;
  SystemModstamp: string;
  [key: string]: unknown;
}

// ============================================================================
// Salesforce Metadata
// ============================================================================

export interface SalesforceStage {
  MasterLabel: string;
  ApiName: string;
  IsActive: boolean;
  IsClosed: boolean;
  IsWon: boolean;
  DefaultProbability: number;
  ForecastCategoryName: string;
  SortOrder: number;
}

export interface SalesforceFieldDescribe {
  name: string;
  label: string;
  type: string;                   // 'string', 'double', 'date', 'datetime', 'picklist', 'reference', etc.
  length: number;
  custom: boolean;
  nillable: boolean;
  picklistValues: { value: string; label: string; active: boolean }[];
  referenceTo: string[];          // Related object names for reference fields
  relationshipName: string | null;
}

export interface SalesforceObjectDescribe {
  name: string;
  label: string;
  fields: SalesforceFieldDescribe[];
  recordTypeInfos: { recordTypeId: string; name: string; active: boolean }[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface SalesforceQueryResult<T = Record<string, unknown>> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface SalesforceBulkJobInfo {
  id: string;
  operation: string;
  object: string;
  state: 'UploadComplete' | 'InProgress' | 'Aborted' | 'JobComplete' | 'Failed';
  numberRecordsProcessed: number;
}

export interface SalesforceApiError {
  errorCode: string;
  message: string;
  fields?: string[];
}

export interface SalesforceOrganization {
  Id: string;
  Name: string;
  OrganizationType: string;       // Professional, Enterprise, Unlimited, Developer
}

// ============================================================================
// Credentials and Configuration
// ============================================================================

export interface SalesforceCredentials {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;            // e.g., https://na1.salesforce.com
  clientId: string;
  clientSecret: string;
}

export interface SalesforceApiLimits {
  used: number;
  total: number;
  percentUsed: number;
}

export interface SalesforceTokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
}

// ============================================================================
// Default Field Lists
// ============================================================================

export const DEFAULT_OPPORTUNITY_FIELDS = [
  'Id',
  'Name',
  'Amount',
  'StageName',
  'CloseDate',
  'Probability',
  'ForecastCategoryName',
  'OwnerId',
  'Owner.Name',
  'Owner.Email',
  'AccountId',
  'Account.Name',
  'Type',
  'LeadSource',
  'IsClosed',
  'IsWon',
  'Description',
  'NextStep',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
];

export const DEFAULT_CONTACT_FIELDS = [
  'Id',
  'FirstName',
  'LastName',
  'Email',
  'Phone',
  'Title',
  'Department',
  'AccountId',
  'Account.Name',
  'OwnerId',
  'Owner.Name',
  'Owner.Email',
  'LeadSource',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
];

export const DEFAULT_ACCOUNT_FIELDS = [
  'Id',
  'Name',
  'Website',
  'Industry',
  'NumberOfEmployees',
  'AnnualRevenue',
  'OwnerId',
  'Owner.Name',
  'Owner.Email',
  'BillingCity',
  'BillingState',
  'BillingCountry',
  'Type',
  'CreatedDate',
  'LastModifiedDate',
  'SystemModstamp',
];
