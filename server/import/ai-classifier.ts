/**
 * AI-Powered Column Classification for File Imports
 *
 * Uses DeepSeek to automatically map CSV/Excel columns to normalized entity fields.
 * Pattern after server/quotas/upload-parser.ts but generalized for deals, contacts, accounts.
 */

import { callLLM } from '../utils/llm-router.js';

export interface ColumnMapping {
  column_index: number | null;
  column_header: string | null;
  confidence: number;
}

export interface DealClassification {
  mapping: {
    name: ColumnMapping;
    amount: ColumnMapping;
    stage: ColumnMapping;
    close_date: ColumnMapping;
    owner: ColumnMapping;
    pipeline: ColumnMapping;
    probability: ColumnMapping;
    account_name: ColumnMapping;
    external_id: ColumnMapping;
    created_date: ColumnMapping;
    forecast_category: ColumnMapping;
    stage_entered_date: ColumnMapping;
  };
  source_crm: string;
  currency: string;
  date_format: string;
  has_header_row: boolean;
  amount_format: string;
  stage_values: string[];
  unmapped_columns: string[];
  row_issues: {
    missing_required: number;
    unparseable_amounts: number;
    unparseable_dates: number;
  };
  notes: string;
}

export interface ContactClassification {
  mapping: {
    email: ColumnMapping;
    first_name: ColumnMapping;
    last_name: ColumnMapping;
    name: ColumnMapping;
    title: ColumnMapping;
    phone: ColumnMapping;
    account_name: ColumnMapping;
    lifecycle_stage: ColumnMapping;
    owner: ColumnMapping;
    external_id: ColumnMapping;
    department: ColumnMapping;
    seniority: ColumnMapping;
    associated_deals: ColumnMapping;
  };
  source_crm: string;
  has_header_row: boolean;
  unmapped_columns: string[];
  row_issues: {
    missing_required: number;
    invalid_emails: number;
  };
  notes: string;
}

export interface AccountClassification {
  mapping: {
    name: ColumnMapping;
    domain: ColumnMapping;
    industry: ColumnMapping;
    employee_count: ColumnMapping;
    annual_revenue: ColumnMapping;
    city: ColumnMapping;
    state: ColumnMapping;
    country: ColumnMapping;
    owner: ColumnMapping;
    external_id: ColumnMapping;
  };
  source_crm: string;
  has_header_row: boolean;
  unmapped_columns: string[];
  row_issues: {
    missing_required: number;
  };
  notes: string;
}

export type ClassificationResult = DealClassification | ContactClassification | AccountClassification;

/**
 * Classify columns for any entity type using DeepSeek
 */
export async function classifyColumns(
  entityType: 'deal' | 'contact' | 'account',
  headers: string[],
  sampleRows: any[][],
  workspaceId: string
): Promise<ClassificationResult> {
  const prompt = buildPrompt(entityType, headers, sampleRows);

  const response = await callLLM(workspaceId, 'classify', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 4096,
    temperature: 0.1,
  });

  try {
    let content = response.content.trim();

    // Extract JSON from markdown code fences if present
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }

    const classification = JSON.parse(content);
    return classification as ClassificationResult;
  } catch (error) {
    console.error('[AIClassifier] AI response:', response.content);
    console.error('[AIClassifier] Parse error:', error);
    throw new Error('Failed to parse AI classification response. Falling back to heuristic classification.');
  }
}

/**
 * Build entity-specific prompt
 */
function buildPrompt(entityType: 'deal' | 'contact' | 'account', headers: string[], sampleRows: any[][]): string {
  // Format sample data as markdown table
  const tableHeader = '| ' + headers.join(' | ') + ' |';
  const tableSeparator = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const tableRows = sampleRows.slice(0, 10).map(row =>
    '| ' + row.map(cell => String(cell ?? '').slice(0, 50)).join(' | ') + ' |'
  ).join('\n');

  const table = `${tableHeader}\n${tableSeparator}\n${tableRows}`;

  switch (entityType) {
    case 'deal':
      return buildDealPrompt(headers, table);
    case 'contact':
      return buildContactPrompt(headers, table);
    case 'account':
      return buildAccountPrompt(headers, table);
  }
}

function buildDealPrompt(headers: string[], table: string): string {
  return `You are analyzing a spreadsheet exported from a CRM to extract sales deal/opportunity data.

Column headers: ${JSON.stringify(headers)}

Sample data (first 10 rows):
${table}

Map each column to one of these normalized deal fields:
- name (REQUIRED): The deal or opportunity name
- amount (REQUIRED): The deal value in dollars/currency
- stage (REQUIRED): The current pipeline stage
- close_date (REQUIRED): Expected or actual close date
- owner: The sales rep who owns the deal
- pipeline: Which sales pipeline the deal belongs to
- probability: Win probability percentage
- account_name: The associated company/account name
- external_id: The CRM record ID (for deduplication on re-import)
- created_date: When the deal was created in the CRM
- forecast_category: Forecast classification (commit, best case, upside, pipeline, omitted)
- stage_entered_date: When the deal entered its current stage

Also determine:
- source_crm: Which CRM this export likely came from (hubspot, salesforce, pipedrive, zoho, dynamics, unknown)
- currency: What currency are amounts in? (USD, EUR, GBP, etc.)
- date_format: What date format is used? (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, excel_serial)
- has_header_row: Is row 1 a header or data?
- amount_format: How are amounts formatted? (numeric, currency_symbol, with_commas, K_M_suffix)
- stage_values: List ALL unique stage values found in the data
- unmapped_columns: Column headers that don't map to any deal field

Respond with ONLY valid JSON, no markdown:
{
  "mapping": {
    "name": { "column_index": 0, "column_header": "Deal Name", "confidence": 0.95 },
    "amount": { "column_index": 3, "column_header": "Amount", "confidence": 0.90 },
    "stage": { "column_index": 2, "column_header": "Deal Stage", "confidence": 0.95 },
    "close_date": { "column_index": 4, "column_header": "Close Date", "confidence": 0.85 },
    "owner": { "column_index": 5, "column_header": "Deal Owner", "confidence": 0.80 },
    "pipeline": { "column_index": null, "column_header": null, "confidence": 0 },
    "account_name": { "column_index": 6, "column_header": "Company", "confidence": 0.75 },
    "external_id": { "column_index": 1, "column_header": "Record ID", "confidence": 0.90 },
    "probability": { "column_index": null, "column_header": null, "confidence": 0 },
    "created_date": { "column_index": 7, "column_header": "Create Date", "confidence": 0.80 },
    "forecast_category": { "column_index": null, "column_header": null, "confidence": 0 },
    "stage_entered_date": { "column_index": null, "column_header": null, "confidence": 0 }
  },
  "source_crm": "hubspot",
  "currency": "USD",
  "date_format": "YYYY-MM-DD",
  "has_header_row": true,
  "amount_format": "currency_symbol",
  "stage_values": ["Discovery", "Proposal Sent", "Negotiation", "Closed Won", "Closed Lost"],
  "unmapped_columns": ["Lead Source", "Custom Field 1", "HubSpot Score"],
  "row_issues": {
    "missing_required": 3,
    "unparseable_amounts": 1,
    "unparseable_dates": 2
  },
  "notes": "Detected HubSpot export format. No pipeline or forecast category columns."
}`;
}

function buildContactPrompt(headers: string[], table: string): string {
  return `You are analyzing a spreadsheet exported from a CRM to extract contact/lead data.

Column headers: ${JSON.stringify(headers)}

Sample data (first 10 rows):
${table}

Map each column to one of these normalized contact fields:
- email (REQUIRED): The contact's email address
- first_name: First name
- last_name: Last name
- name: Full name (fallback if no first/last split)
- title: Job title/position
- phone: Phone number
- account_name: Associated company name
- lifecycle_stage: Lead status (lead, MQL, SQL, opportunity, customer, etc.)
- owner: Sales rep who owns this contact
- external_id: The CRM record ID (for deduplication)
- department: Department (sales, marketing, engineering, etc.)
- seniority: Seniority level (IC, manager, director, VP, C-level)
- associated_deals: Column containing deal names or IDs linked to this contact (e.g. "Associated Deals", "Deal Name", "Opportunity")

Also determine:
- source_crm: Which CRM this export likely came from (hubspot, salesforce, pipedrive, zoho, dynamics, unknown)
- has_header_row: Is row 1 a header or data?
- unmapped_columns: Column headers that don't map to any contact field

Respond with ONLY valid JSON, no markdown:
{
  "mapping": {
    "email": { "column_index": 1, "column_header": "Email", "confidence": 0.95 },
    "first_name": { "column_index": 2, "column_header": "First Name", "confidence": 0.90 },
    "last_name": { "column_index": 3, "column_header": "Last Name", "confidence": 0.90 },
    "name": { "column_index": null, "column_header": null, "confidence": 0 },
    "title": { "column_index": 4, "column_header": "Job Title", "confidence": 0.85 },
    "phone": { "column_index": 5, "column_header": "Phone", "confidence": 0.80 },
    "account_name": { "column_index": 6, "column_header": "Company", "confidence": 0.85 },
    "lifecycle_stage": { "column_index": 7, "column_header": "Lead Status", "confidence": 0.75 },
    "owner": { "column_index": null, "column_header": null, "confidence": 0 },
    "external_id": { "column_index": 0, "column_header": "Contact ID", "confidence": 0.90 },
    "department": { "column_index": null, "column_header": null, "confidence": 0 },
    "seniority": { "column_index": null, "column_header": null, "confidence": 0 },
    "associated_deals": { "column_index": null, "column_header": null, "confidence": 0 }
  },
  "source_crm": "salesforce",
  "has_header_row": true,
  "unmapped_columns": ["Lead Source", "Industry"],
  "row_issues": {
    "missing_required": 2,
    "invalid_emails": 3
  },
  "notes": "Detected Salesforce export. No department or seniority columns found."
}`;
}

function buildAccountPrompt(headers: string[], table: string): string {
  return `You are analyzing a spreadsheet exported from a CRM to extract account/company data.

Column headers: ${JSON.stringify(headers)}

Sample data (first 10 rows):
${table}

Map each column to one of these normalized account fields:
- name (REQUIRED): The company/account name
- domain: Website domain (example.com)
- industry: Industry or vertical
- employee_count: Number of employees
- annual_revenue: Annual revenue in dollars
- city: City location
- state: State/province
- country: Country
- owner: Account owner/sales rep
- external_id: The CRM record ID (for deduplication)

Also determine:
- source_crm: Which CRM this export likely came from (hubspot, salesforce, pipedrive, zoho, dynamics, unknown)
- has_header_row: Is row 1 a header or data?
- unmapped_columns: Column headers that don't map to any account field

Respond with ONLY valid JSON, no markdown:
{
  "mapping": {
    "name": { "column_index": 0, "column_header": "Company Name", "confidence": 0.95 },
    "domain": { "column_index": 1, "column_header": "Website", "confidence": 0.85 },
    "industry": { "column_index": 2, "column_header": "Industry", "confidence": 0.90 },
    "employee_count": { "column_index": 3, "column_header": "Employees", "confidence": 0.80 },
    "annual_revenue": { "column_index": 4, "column_header": "Revenue", "confidence": 0.75 },
    "city": { "column_index": 5, "column_header": "City", "confidence": 0.85 },
    "state": { "column_index": 6, "column_header": "State", "confidence": 0.85 },
    "country": { "column_index": 7, "column_header": "Country", "confidence": 0.90 },
    "owner": { "column_index": null, "column_header": null, "confidence": 0 },
    "external_id": { "column_index": null, "column_header": null, "confidence": 0 }
  },
  "source_crm": "hubspot",
  "has_header_row": true,
  "unmapped_columns": ["Last Activity Date", "Create Date"],
  "row_issues": {
    "missing_required": 0
  },
  "notes": "Detected HubSpot export. All core fields mapped successfully."
}`;
}
