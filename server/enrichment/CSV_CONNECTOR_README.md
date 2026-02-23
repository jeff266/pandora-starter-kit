# CSV Enrichment Connector

Universal fallback connector for importing enrichment data from any provider that supports CSV or Excel export (ZoomInfo, Cognism, LinkedIn Sales Navigator, Lusha, etc.).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CSV IMPORT WORKFLOW                         │
├───────────────────────────────────────────────────────────────┤
│  1. Upload File (CSV/Excel)                                   │
│     ↓                                                          │
│  2. Parse & Detect Columns                                    │
│     ↓                                                          │
│  3. Auto-Suggest Mappings                                     │
│     ↓                                                          │
│  4. User Confirms/Overrides Mappings                          │
│     ↓                                                          │
│  5. Process Import                                            │
│     - Apply mappings                                          │
│     - Normalize data                                          │
│     - Match to CRM accounts                                   │
│     - Calculate confidence scores                             │
│     - Save to enriched_accounts                               │
│     ↓                                                          │
│  6. Return Summary + Unmatched Records                        │
└───────────────────────────────────────────────────────────────┘
```

## Components

### 1. CSV Parser (`csv-parser.ts`)

Parses CSV and Excel files into structured data.

**Supported Formats:**
- CSV (.csv)
- Excel (.xlsx)
- Excel Legacy (.xls)

**File Limits:**
- Max size: 25MB
- Max rows: 10,000

**Encoding Support:**
- UTF-8 (preferred)
- Latin-1 (auto-converted)
- BOM detection and removal

**Functions:**
- `parseFile(buffer, filename)` - Parse file to structured data
- `validateIdentifierColumns(headers)` - Ensure domain or company_name present

**Return Format:**
```typescript
{
  headers: string[];
  rows: Record<string, any>[];
  row_count: number;
  file_info: {
    filename: string;
    size: number;
    format: 'csv' | 'xlsx' | 'xls';
  };
}
```

### 2. Column Mapper (`csv-mapper.ts`)

Auto-detects column mappings based on common naming patterns.

**Mapping Patterns (per spec 5.3):**

| Source Column Variations | Pandora Field |
|-------------------------|---------------|
| Domain, Website, Company URL, Web Address | `domain` |
| Company, Company Name, Account Name, Organization | `company_name` |
| Industry, Vertical, Sector | `industry` |
| Employees, Headcount, Team Size, # Employees | `employee_count` |
| Employee Range, Size Range, Company Size | `employee_range` |
| Revenue, Annual Revenue, ARR, Estimated Revenue | `revenue_range` |
| Funding Stage, Funding Round, Funding | `funding_stage` |
| Country, HQ Country, Location (Country) | `hq_country` |
| State, Province, Region | `hq_state` |
| City, HQ City | `hq_city` |
| Technologies, Tech Stack, Tools Used, Software | `tech_stack` |
| Growth, Growth Signal, Company Growth | `growth_signal` |
| Founded, Year Founded, Est. | `founded_year` |
| Public/Private, Ownership, Company Type | `public_or_private` |

**Matching Algorithm:**
1. **Exact match** (similarity 1.0) - "domain" → "domain"
2. **Contains match** (similarity 0.85) - "Company Domain" → "domain"
3. **Word-based match** (similarity 0.75) - "HQ Country" → "hq_country"
4. **Levenshtein distance** (similarity 0.0-1.0) - fuzzy match

**Confidence Levels:**
- **High** (≥0.9) - Exact or very close match
- **Medium** (0.7-0.89) - Good match
- **Low** (0.5-0.69) - Weak match

**Functions:**
- `suggestMappings(headers)` - Auto-detect column mappings
- `validateMapping(mappings, headers)` - Validate user-confirmed mappings
- `applyMapping(row, mappings)` - Apply mappings to a data row

**Suggested Mapping Response:**
```typescript
{
  mappings: [
    {
      source_column: "Domain",
      pandora_field: "domain",
      confidence: "high"
    },
    {
      source_column: "Company",
      pandora_field: "company_name",
      confidence: "high"
    }
  ],
  unmapped_columns: ["Internal ID", "Sales Rep"],
  has_required_fields: true
}
```

### 3. Import Processor (`csv-import.ts`)

Processes CSV imports with matching and confidence scoring.

**Processing Steps:**
1. Create import record in `csv_imports` table
2. For each row:
   - Apply column mappings
   - Normalize data (uses webhook normalizer for flexibility)
   - Match to CRM account (domain exact or fuzzy name)
   - Calculate confidence score
   - Save to `enriched_accounts` table
3. Track unmatched records
4. Calculate average confidence
5. Finalize import record

**Functions:**
- `processCSVImport(workspaceId, rows, mappings, fileInfo)` - Main import logic
- `getImportHistory(workspaceId, limit)` - Import history
- `getUnmatchedRecords(workspaceId, importId)` - Unmatched records

**Import Result:**
```typescript
{
  import_id: "csvi_abc123",
  success: true,
  records_imported: 95,
  records_matched: 95,
  records_unmatched: 5,
  average_confidence: 0.87,
  unmatched_records: [
    {
      row_index: 12,
      data: { domain: "unknown.com", company_name: "Unknown Corp" },
      error: "No matching CRM account found"
    }
  ],
  errors: []
}
```

## Database Schema

### `csv_imports` Table

Tracks CSV/Excel import history.

```sql
id                    TEXT PRIMARY KEY
workspace_id          TEXT REFERENCES workspaces
filename              TEXT
file_size             INTEGER
row_count             INTEGER
column_mappings       JSONB (user-confirmed mappings)
records_imported      INTEGER
records_matched       INTEGER
records_unmatched     INTEGER
unmatched_records     JSONB
average_confidence    REAL
status                TEXT (pending, processing, completed, failed)
error_message         TEXT
imported_at           TIMESTAMPTZ
created_at            TIMESTAMPTZ
```

## API Routes

### 1. Upload & Preview

#### POST `/:workspaceId/enrichment/csv/upload`

Upload CSV/Excel file and get column mapping suggestions.

**Does NOT process import** - only parses and suggests mappings.

**Request:**
- Form-data with `file` field
- File types: .csv, .xlsx, .xls
- Max size: 25MB

**Response:**
```json
{
  "file_info": {
    "filename": "enrichment-data.csv",
    "size": 125000,
    "format": "csv"
  },
  "headers": ["Domain", "Company", "Industry", "Employees"],
  "row_count": 150,
  "preview_rows": [
    {
      "Domain": "acme.com",
      "Company": "Acme Corp",
      "Industry": "SaaS",
      "Employees": "145"
    }
  ],
  "suggested_mappings": [
    {
      "source_column": "Domain",
      "pandora_field": "domain",
      "confidence": "high"
    },
    {
      "source_column": "Company",
      "pandora_field": "company_name",
      "confidence": "high"
    },
    {
      "source_column": "Industry",
      "pandora_field": "industry",
      "confidence": "high"
    },
    {
      "source_column": "Employees",
      "pandora_field": "employee_count",
      "confidence": "medium"
    }
  ],
  "unmapped_columns": [],
  "has_required_fields": true
}
```

### 2. Process Import

#### POST `/:workspaceId/enrichment/csv/import`

Process CSV import with user-confirmed column mappings.

**Request:**
- Form-data with `file` field
- Form-data with `mappings` field (JSON string)

**Mappings Format:**
```json
[
  {
    "source_column": "Domain",
    "pandora_field": "domain",
    "confidence": "high"
  },
  {
    "source_column": "Company",
    "pandora_field": "company_name",
    "confidence": "high"
  },
  {
    "source_column": "Internal ID",
    "pandora_field": "skip",
    "confidence": "high"
  }
]
```

**Response:**
```json
{
  "success": true,
  "import_id": "csvi_abc123",
  "records_imported": 95,
  "records_matched": 95,
  "records_unmatched": 5,
  "average_confidence": 0.87,
  "unmatched_count": 5,
  "message": "Successfully imported 95 records. 5 records could not be matched."
}
```

### 3. Import History

#### GET `/:workspaceId/enrichment/csv/imports?limit=50`

Get CSV import history for workspace.

**Response:**
```json
{
  "imports": [
    {
      "id": "csvi_abc123",
      "filename": "enrichment-data.csv",
      "file_size": 125000,
      "row_count": 100,
      "records_imported": 95,
      "records_matched": 95,
      "records_unmatched": 5,
      "average_confidence": 0.87,
      "status": "completed",
      "imported_at": "2026-02-22T10:00:00Z",
      "created_at": "2026-02-22T09:55:00Z"
    }
  ]
}
```

### 4. Unmatched Records

#### GET `/:workspaceId/enrichment/csv/imports/:importId/unmatched`

Get unmatched records from a specific import.

**Response:**
```json
{
  "import_id": "csvi_abc123",
  "unmatched_count": 5,
  "unmatched_records": [
    {
      "row_index": 12,
      "data": {
        "domain": "unknown.com",
        "company_name": "Unknown Corp",
        "industry": "SaaS"
      },
      "error": "No matching CRM account found"
    }
  ]
}
```

#### GET `/:workspaceId/enrichment/csv/imports/:importId/unmatched/download`

Download unmatched records as CSV for investigation.

**Response:**
- Content-Type: text/csv
- Includes: Row Index, Error, and all original columns

## Tech Stack Handling

The CSV connector accepts multiple formats for `tech_stack` column:

**1. Pipe-separated string:**
```
Salesforce|Gong|Slack|Stripe
```

**2. Comma-separated string:**
```
Salesforce, Gong, Slack, Stripe
```

**3. JSON array string:**
```
["Salesforce", "Gong", "Slack", "Stripe"]
```

**4. Single value:**
```
Salesforce
```

All formats are normalized to array: `["Salesforce", "Gong", "Slack", "Stripe"]`

## Column Mapping Workflow

### 1. Auto-Detection Phase

User uploads file → API parses → suggests mappings based on patterns.

**Example:**
- "Company Domain" → `domain` (high confidence)
- "# of Employees" → `employee_count` (medium confidence)
- "Internal CRM ID" → unmapped

### 2. User Confirmation Phase

User reviews suggestions in UI:
- **Accept** - Use suggested mapping
- **Override** - Change to different field
- **Skip** - Don't import this column

### 3. Import Phase

API validates mappings → processes import → returns summary.

## Error Handling

### File Validation Errors

| Error | HTTP Status | Details |
|-------|-------------|---------|
| File too large | 400 | Max 25MB |
| Too many rows | 400 | Max 10,000 rows |
| Unsupported format | 400 | Only .csv, .xlsx, .xls |
| Empty file | 400 | No data rows |
| No headers | 400 | Header row required |
| Missing identifiers | 400 | Need domain or company_name column |

### Mapping Validation Errors

| Error | Details |
|-------|---------|
| Source column not found | Column in mapping doesn't exist in file |
| Duplicate mapping | Same column mapped multiple times |
| Duplicate field | Same Pandora field used twice (except 'skip') |
| Missing required fields | No domain or company_name mapped |

### Import Processing Errors

Logged in `unmatched_records`:
- Normalization errors (invalid data format)
- No matching CRM account
- Field type mismatches

## Usage Example

### Step 1: Upload for Preview

```bash
curl -X POST https://app.pandora.io/api/workspaces/ws_123/enrichment/csv/upload \
  -F "file=@enrichment-data.csv"
```

**Response includes suggested mappings.**

### Step 2: Confirm Mappings & Import

```bash
curl -X POST https://app.pandora.io/api/workspaces/ws_123/enrichment/csv/import \
  -F "file=@enrichment-data.csv" \
  -F 'mappings=[
    {"source_column":"Domain","pandora_field":"domain","confidence":"high"},
    {"source_column":"Company","pandora_field":"company_name","confidence":"high"},
    {"source_column":"Industry","pandora_field":"industry","confidence":"high"}
  ]'
```

### Step 3: Download Unmatched Records

```bash
curl https://app.pandora.io/api/workspaces/ws_123/enrichment/csv/imports/csvi_abc123/unmatched/download \
  -o unmatched-records.csv
```

## Integration with Other Connectors

CSV connector writes to the same `enriched_accounts` table with:
- `enrichment_source = 'csv'`
- `pandora_batch_id = import_id` (for idempotency)
- Same confidence scoring algorithm
- Same account matching logic (domain exact + fuzzy name)

This ensures consistent data quality regardless of source (Apollo, Webhook, or CSV).

## Best Practices

1. **Export from Source System**
   - Include domain column (preferred) or company name
   - Export all available firmographic fields
   - Use CSV for better encoding control

2. **Review Suggested Mappings**
   - Check high-confidence mappings are correct
   - Override medium/low confidence if needed
   - Map tech_stack if available

3. **Handle Unmatched Records**
   - Download unmatched CSV
   - Investigate why accounts didn't match
   - Add missing domains to CRM
   - Re-upload corrected data

4. **Monitor Import Quality**
   - Track average confidence scores
   - Aim for >0.7 average confidence
   - Low confidence indicates incomplete data

## Testing

Test file parsing:
```typescript
import { parseFile } from './enrichment/csv-parser.js';
import fs from 'fs';

const buffer = fs.readFileSync('test-data.csv');
const parsed = await parseFile(buffer, 'test-data.csv');

console.log('Headers:', parsed.headers);
console.log('Rows:', parsed.row_count);
```

Test column mapping:
```typescript
import { suggestMappings } from './enrichment/csv-mapper.js';

const headers = ['Domain', 'Company Name', 'Industry', '# Employees'];
const suggestions = suggestMappings(headers);

console.log('Suggested mappings:', suggestions.mappings);
console.log('Has required fields:', suggestions.has_required_fields);
```

Test import processing:
```typescript
import { processCSVImport } from './enrichment/csv-import.js';

const result = await processCSVImport('ws_123', rows, mappings, {
  filename: 'test.csv',
  size: 1024,
});

console.log('Imported:', result.records_matched);
console.log('Unmatched:', result.records_unmatched);
console.log('Avg confidence:', result.average_confidence);
```

## Next Steps

1. ✅ Database migration
2. ✅ File parsing (CSV/Excel)
3. ✅ Auto-detection of column mappings
4. ✅ Import processing with matching
5. ✅ Unmatched records download
6. ⏳ UI for file upload and column mapping
7. ⏳ Batch import support (split large files)
