export interface MappedColumn {
  columnIndex: number;
  columnHeader: string;
  confidence: number;
  source: 'heuristic';
}

export interface ColumnMapping {
  mapping: Record<string, MappedColumn>;
  unmappedColumns: string[];
  warnings: string[];
}

interface FieldPattern {
  field: string;
  exact: RegExp[];
  partial: RegExp[];
}

const DEAL_PATTERNS: FieldPattern[] = [
  { field: 'name', exact: [/^deal.?name$/i, /^opportunity.?name$/i, /^name$/i], partial: [/deal.?name/i, /opportunity/i] },
  { field: 'amount', exact: [/^amount$/i, /^deal.?amount$/i, /^value$/i], partial: [/amount/i, /value/i, /revenue/i, /acv/i, /arr/i] },
  { field: 'stage', exact: [/^stage$/i, /^deal.?stage$/i], partial: [/stage/i, /status/i, /pipeline.?stage/i] },
  { field: 'close_date', exact: [/^close.?date$/i, /^expected.?close$/i], partial: [/close/i, /expected.?close/i, /close.?by/i] },
  { field: 'owner', exact: [/^owner$/i, /^deal.?owner$/i, /^rep$/i], partial: [/owner/i, /rep/i, /sales.?rep/i, /assigned/i] },
  { field: 'pipeline', exact: [/^pipeline$/i], partial: [/pipeline/i] },
  { field: 'account_name', exact: [/^company$/i, /^account$/i, /^company.?name$/i, /^account.?name$/i], partial: [/company/i, /account/i] },
  { field: 'external_id', exact: [/^record.?id$/i, /^deal.?id$/i, /^opportunity.?id$/i, /^hubspot.?id$/i, /^id$/i], partial: [/record.?id/i, /deal.?id/i, /hubspot.?id/i, /salesforce.?id/i] },
  { field: 'probability', exact: [/^probability$/i, /^win.?prob$/i], partial: [/probability/i, /win.?prob/i, /percent/i] },
  { field: 'created_date', exact: [/^create.?date$/i, /^created$/i, /^date.?created$/i], partial: [/create.?date/i, /created/i] },
];

const CONTACT_PATTERNS: FieldPattern[] = [
  { field: 'first_name', exact: [/^first.?name$/i, /^first$/i], partial: [/first.?name/i] },
  { field: 'last_name', exact: [/^last.?name$/i, /^last$/i, /^surname$/i], partial: [/last.?name/i, /surname/i] },
  { field: 'full_name', exact: [/^name$/i, /^full.?name$/i, /^contact.?name$/i], partial: [/full.?name/i, /contact.?name/i] },
  { field: 'email', exact: [/^email$/i, /^e.?mail$/i, /^email.?address$/i], partial: [/email/i, /e.?mail/i] },
  { field: 'phone', exact: [/^phone$/i, /^phone.?number$/i, /^mobile$/i], partial: [/phone/i, /mobile/i, /tel/i] },
  { field: 'title', exact: [/^title$/i, /^job.?title$/i, /^position$/i], partial: [/title/i, /position/i, /role$/i] },
  { field: 'department', exact: [/^department$/i, /^dept$/i], partial: [/department/i, /dept/i] },
  { field: 'account_name', exact: [/^company$/i, /^account$/i, /^company.?name$/i, /^account.?name$/i, /^organization$/i], partial: [/company/i, /account/i, /organization/i] },
  { field: 'lifecycle_stage', exact: [/^lifecycle.?stage$/i, /^lead.?status$/i], partial: [/lifecycle/i, /lead.?status/i] },
  { field: 'external_id', exact: [/^record.?id$/i, /^contact.?id$/i, /^hubspot.?id$/i, /^id$/i], partial: [/contact.?id/i, /record.?id/i] },
  { field: 'seniority', exact: [/^seniority$/i, /^level$/i], partial: [/seniority/i] },
  { field: 'associated_deals', exact: [/^associated.?deals?$/i, /^deal.?name$/i, /^opportunity$/i, /^opportunity.?name$/i], partial: [/associated.?deal/i, /deal.?name/i, /opportunity/i] },
];

const ACCOUNT_PATTERNS: FieldPattern[] = [
  { field: 'name', exact: [/^name$/i, /^company.?name$/i, /^account.?name$/i, /^company$/i, /^account$/i], partial: [/company/i, /account/i, /organization/i] },
  { field: 'domain', exact: [/^domain$/i, /^website$/i, /^url$/i], partial: [/domain/i, /website/i, /url/i] },
  { field: 'industry', exact: [/^industry$/i, /^sector$/i], partial: [/industry/i, /sector/i, /vertical/i] },
  { field: 'employee_count', exact: [/^employees$/i, /^employee.?count$/i, /^headcount$/i, /^size$/i], partial: [/employee/i, /headcount/i, /company.?size/i] },
  { field: 'annual_revenue', exact: [/^annual.?revenue$/i, /^revenue$/i, /^arr$/i], partial: [/revenue/i, /annual/i] },
  { field: 'owner', exact: [/^owner$/i, /^account.?owner$/i], partial: [/owner/i, /assigned/i] },
  { field: 'external_id', exact: [/^record.?id$/i, /^account.?id$/i, /^hubspot.?id$/i, /^id$/i], partial: [/account.?id/i, /record.?id/i] },
];

function getPatternsForEntity(entityType: 'deal' | 'contact' | 'account'): FieldPattern[] {
  switch (entityType) {
    case 'deal': return DEAL_PATTERNS;
    case 'contact': return CONTACT_PATTERNS;
    case 'account': return ACCOUNT_PATTERNS;
  }
}

export function heuristicMapColumns(
  entityType: 'deal' | 'contact' | 'account',
  headers: string[],
  _sampleRows: any[][]
): ColumnMapping {
  const patterns = getPatternsForEntity(entityType);
  const mapping: Record<string, MappedColumn> = {};
  const usedIndices = new Set<number>();
  const warnings: string[] = [];

  for (const pattern of patterns) {
    let bestMatch: { index: number; confidence: number } | null = null;

    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue;
      const header = headers[i].trim();
      if (!header) continue;

      if (pattern.exact.some(rx => rx.test(header))) {
        if (!bestMatch || 0.95 > bestMatch.confidence) {
          bestMatch = { index: i, confidence: 0.95 };
        }
      } else if (pattern.partial.some(rx => rx.test(header))) {
        if (!bestMatch || 0.75 > bestMatch.confidence) {
          bestMatch = { index: i, confidence: 0.75 };
        }
      }
    }

    if (bestMatch) {
      mapping[pattern.field] = {
        columnIndex: bestMatch.index,
        columnHeader: headers[bestMatch.index],
        confidence: bestMatch.confidence,
        source: 'heuristic',
      };
      usedIndices.add(bestMatch.index);
    }
  }

  const unmappedColumns = headers.filter((_, i) => !usedIndices.has(i));

  const requiredFields: Record<string, string[]> = {
    deal: ['name'],
    contact: ['email'],
    account: ['name'],
  };

  const required = requiredFields[entityType] || [];
  for (const req of required) {
    if (!mapping[req]) {
      warnings.push(`Required field "${req}" could not be mapped to any column`);
    }
  }

  if (unmappedColumns.length > 0) {
    warnings.push(`${unmappedColumns.length} column(s) were not mapped: ${unmappedColumns.join(', ')}`);
  }

  return { mapping, unmappedColumns, warnings };
}
