# Activity Signals Test Script for Replit

**Purpose**: Verify activity body visibility and signal extraction system (T001-T012)

---

## Pre-Test Setup

### 1. Verify Migrations Applied

```bash
# Connect to database
psql $DATABASE_URL

# Check tables exist
\dt activity_signals
\dt activity_signal_runs

# Check context_layer has qualification_framework
SELECT definitions->'qualification_framework' FROM context_layer LIMIT 1;

# Exit psql
\q
```

**Expected**: All 3 tables exist, qualification_framework shows MEDDIC config.

---

## Part 1: Database State Verification

### 2. Check Activity Body Content

```bash
psql $DATABASE_URL -c "
SELECT
  COUNT(*) as total_activities,
  COUNT(CASE WHEN body IS NOT NULL THEN 1 END) as with_body,
  COUNT(CASE WHEN body IS NOT NULL AND LENGTH(body) > 100 THEN 1 END) as body_over_100_chars,
  COUNT(CASE WHEN subject IS NULL AND body IS NOT NULL THEN 1 END) as null_subject_with_body
FROM activities
WHERE workspace_id = (SELECT id FROM workspaces LIMIT 1);
"
```

**Expected Output**:
```
 total_activities | with_body | body_over_100_chars | null_subject_with_body
------------------+-----------+---------------------+------------------------
             7515 |      7515 |                6421 |                   1454
```

This confirms:
- ✅ 7,515 total activities
- ✅ All have body content
- ✅ 6,421 have substantive body (>100 chars) eligible for extraction
- ✅ 1,454 notes have null subject but body content (previously invisible)

---

## Part 2: Preprocessing Utilities Test

### 3. Test Activity Text Utils

Create test file: `server/test-activity-text.ts`

```typescript
import {
  stripHtml,
  stripReplyThreads,
  parseEmailHeaders,
  classifyEmailParticipants,
  cleanActivityBody
} from './utils/activity-text.js';

// Test 1: HTML stripping
const htmlSample = '<p>Hello &amp; welcome</p><br/><strong>Call scheduled</strong>';
console.log('=== Test 1: HTML Stripping ===');
console.log('Input:', htmlSample);
console.log('Output:', stripHtml(htmlSample));
console.log('Expected: "Hello & welcome Call scheduled"\n');

// Test 2: Reply thread removal
const replySample = `Meeting notes from today.

On Wed, Jan 15, 2024 at 3:00 PM John Doe <john@customer.com> wrote:
> Thanks for the demo
> Looking forward to next steps`;

console.log('=== Test 2: Reply Thread Removal ===');
console.log('Input length:', replySample.length);
console.log('Output:', stripReplyThreads(replySample));
console.log('Expected: Only first line remains\n');

// Test 3: Email header parsing
const emailSample = `To: john@customer.com, jane@customer.com
CC: bob@customer.com
BCC: --none--
Subject: RE: Product Demo Follow-up
Body: Thanks for taking the time to meet today. As discussed, our Q3 timeline is critical.`;

console.log('=== Test 3: Email Header Parsing ===');
const headers = parseEmailHeaders(emailSample);
console.log('To:', headers.to);
console.log('CC:', headers.cc);
console.log('Subject:', headers.subject);
console.log('Body preview:', headers.bodyText.substring(0, 50));
console.log('Has headers:', headers.hasHeaders);
console.log('Expected: to=[2 emails], cc=[1 email], subject=RE: Product Demo...\n');

// Test 4: Direction classification
console.log('=== Test 4: Direction Classification ===');
const participants = classifyEmailParticipants(headers, 'mycompany.com');
console.log('Direction:', participants.direction);
console.log('Prospect addresses:', participants.prospectAddresses);
console.log('Internal addresses:', participants.internalAddresses);
console.log('Expected: direction=outbound (sent to customer), prospect=[3 emails]\n');

// Test 5: Combined cleaning
const messyEmail = `<p>Follow-up from call:</p>
<ul><li>Budget: $50K approved</li><li>Timeline: Q3 go-live</li></ul>

On Jan 10, 2024 at 2:00 PM Jane Smith wrote:
> Let's schedule a follow-up
> Thanks`;

console.log('=== Test 5: Combined Cleaning ===');
console.log('Input length:', messyEmail.length);
const cleaned = cleanActivityBody(messyEmail, 'email');
console.log('Cleaned:', cleaned);
console.log('Expected: Only first section, no reply thread, no HTML\n');
```

Run test:
```bash
npx tsx server/test-activity-text.ts
```

**Expected**: All 5 tests pass with correct output.

---

## Part 3: Signal Extraction Test (Manual)

### 4. Test Signal Extraction on Sample Activities

Create test file: `server/test-signal-extraction.ts`

```typescript
import { extractActivitySignals } from './signals/extract-activity-signals.js';
import { query } from './db.js';

async function testExtraction() {
  // Get workspace ID
  const wsResult = await query('SELECT id FROM workspaces LIMIT 1');
  const workspaceId = wsResult.rows[0].id;

  console.log('=== Testing Activity Signal Extraction ===');
  console.log('Workspace ID:', workspaceId);

  // Run extraction on first 10 unprocessed activities
  const result = await extractActivitySignals(workspaceId, { limit: 10 });

  console.log('\nExtraction Results:');
  console.log('- Processed:', result.processed);
  console.log('- Extracted signals:', result.extracted);
  console.log('- Skipped:', result.skipped);
  console.log('- Errors:', result.errors.length);
  console.log('- Tokens used:', result.tokens_used);
  console.log('- Duration:', result.duration_ms, 'ms');

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(err => console.log(' -', err));
  }

  // Check what signals were created
  const signalCheck = await query(`
    SELECT signal_type, COUNT(*) as count
    FROM activity_signals
    WHERE workspace_id = $1
    GROUP BY signal_type
    ORDER BY count DESC
  `, [workspaceId]);

  console.log('\nSignal Type Breakdown:');
  signalCheck.rows.forEach(row => {
    console.log(`- ${row.signal_type}: ${row.count}`);
  });

  // Sample some signals
  const samples = await query(`
    SELECT signal_type, signal_value, framework_field, speaker_type,
           confidence, extraction_method, source_quote
    FROM activity_signals
    WHERE workspace_id = $1
    ORDER BY extracted_at DESC
    LIMIT 5
  `, [workspaceId]);

  console.log('\nSample Signals:');
  samples.rows.forEach((s, i) => {
    console.log(`\n${i + 1}. ${s.signal_type} (${s.extraction_method})`);
    console.log('   Value:', s.signal_value);
    if (s.framework_field) console.log('   Framework:', s.framework_field);
    console.log('   Speaker:', s.speaker_type, `(${(s.confidence * 100).toFixed(0)}% conf)`);
    console.log('   Quote:', s.source_quote?.substring(0, 80) + '...');
  });

  process.exit(0);
}

testExtraction().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

Run test:
```bash
npx tsx server/test-signal-extraction.ts
```

**Expected Output**:
```
=== Testing Activity Signal Extraction ===
Workspace ID: abc-123-...

Extraction Results:
- Processed: 10
- Extracted signals: 23
- Skipped: 2
- Errors: 0
- Tokens used: ~13000
- Duration: 8432 ms

Signal Type Breakdown:
- framework_signal: 8
- notable_quote: 6
- timeline_mention: 4
- untracked_participant: 3
- buyer_signal: 2

Sample Signals:
1. framework_signal (deepseek)
   Value: Need to present to CFO for budget approval
   Framework: economic_buyer
   Speaker: prospect (85% conf)
   Quote: "I'll need to present this to our CFO for budget approval next week"...

2. untracked_participant (header_parse)
   Value: bob.johnson@customer.com
   Speaker: prospect (95% conf)
   Quote: CC/BCC: bob.johnson@customer.com...
```

---

## Part 4: Dossier API Test

### 5. Test Activity Body in Dossier Response

```bash
# Get a deal ID
DEAL_ID=$(psql $DATABASE_URL -t -c "SELECT id FROM deals WHERE workspace_id = (SELECT id FROM workspaces LIMIT 1) LIMIT 1" | tr -d ' ')

# Fetch dossier
curl -s "http://localhost:3000/api/workspaces/$(psql $DATABASE_URL -t -c "SELECT id FROM workspaces LIMIT 1" | tr -d ' ')/dossiers/deals/$DEAL_ID" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.activities[0]'
```

**Expected**: Response includes `body` field with activity content:
```json
{
  "id": "act-123",
  "type": "email",
  "date": "2024-01-15T10:30:00Z",
  "subject": "RE: Product Demo Follow-up",
  "owner_email": "rep@company.com",
  "body": "Thanks for taking the time to meet today. As discussed..."
}
```

---

## Part 5: Query Tool Test

### 6. Test query_activity_signals Function

Create test file: `server/test-query-signals.ts`

```typescript
import { queryActivitySignals } from './signals/query-activity-signals.js';
import { query } from './db.js';

async function testQuery() {
  const wsResult = await query('SELECT id FROM workspaces LIMIT 1');
  const workspaceId = wsResult.rows[0].id;

  console.log('=== Test 1: Get All Signals ===');
  const all = await queryActivitySignals(workspaceId, { limit: 10 });
  console.log('Total signals:', all.total);
  console.log('Returned:', all.signals.length);
  console.log('Sample:', all.signals[0]);

  console.log('\n=== Test 2: Filter by Framework Field ===');
  const meddic = await queryActivitySignals(workspaceId, {
    signal_type: 'framework_signal',
    framework_field: 'timeline',
    limit: 5
  });
  console.log('Timeline signals:', meddic.total);
  meddic.signals.forEach(s => {
    console.log(`- ${s.signal_value} (${s.speaker_type})`);
  });

  console.log('\n=== Test 3: Filter by Speaker Type ===');
  const prospectQuotes = await queryActivitySignals(workspaceId, {
    signal_type: 'notable_quote',
    speaker_type: 'prospect',
    verbatim_only: true,
    limit: 5
  });
  console.log('Prospect quotes:', prospectQuotes.total);
  prospectQuotes.signals.forEach(s => {
    console.log(`- "${s.source_quote}"`);
  });

  console.log('\n=== Test 4: Untracked Participants ===');
  const untracked = await queryActivitySignals(workspaceId, {
    signal_type: 'untracked_participant',
    limit: 10
  });
  console.log('Untracked emails:', untracked.total);
  untracked.signals.forEach(s => {
    console.log(`- ${s.signal_value} (on deal: ${s.deal_name || 'none'})`);
  });

  process.exit(0);
}

testQuery().catch(err => {
  console.error('Query test failed:', err);
  process.exit(1);
});
```

Run test:
```bash
npx tsx server/test-query-signals.ts
```

**Expected**: All 4 queries return filtered results correctly.

---

## Part 6: Ask Pandora Integration Test

### 7. Test Chat Agent Tool

Start the dev server:
```bash
npm run dev
```

Open chat interface and test these queries:

**Test 1: Framework Coverage**
```
User: "Show me all MEDDIC signals for our top 3 deals"
```
Expected: Tool call to `query_activity_signals` with `signal_type: 'framework_signal'`, returns signals grouped by framework field.

**Test 2: Prospect Quotes**
```
User: "What have prospects said about our timeline in recent emails?"
```
Expected: Tool call with `signal_type: 'timeline_mention'`, `speaker_type: 'prospect'`, returns verbatim quotes.

**Test 3: Blockers**
```
User: "Are there any blockers mentioned in CRM notes across open deals?"
```
Expected: Tool call with `signal_type: 'blocker_mention'`, groups by deal.

**Test 4: Untracked Stakeholders**
```
User: "Who are the untracked email participants on the Acme deal?"
```
Expected: Tool call with `signal_type: 'untracked_participant'`, `deal_id: '<acme-id>'`, returns email addresses.

**Test 5: Framework-Specific**
```
User: "Do we have economic buyer identified for any deals?"
```
Expected: Tool call with `framework_field: 'economic_buyer'`, returns framework_signal entries.

---

## Part 7: Frontend Timeline Test

### 8. Verify Activity Body Display

1. Navigate to a deal detail page in the UI
2. Scroll to "Activity Timeline" section
3. Find an activity (email/note) with a "Show note" button
4. Click "Show note"

**Expected**:
- Button changes to "Hide note"
- Activity body content appears below (HTML-stripped, max 400 chars)
- Stage markers appear as visual dividers between timeline items
- Current stage is highlighted with accent color

---

## Part 8: Full Extraction Run (Optional)

### 9. Run Full Workspace Extraction

**⚠️ WARNING**: This will process ALL unprocessed activities and consume DeepSeek tokens.

```typescript
// server/test-full-extraction.ts
import { extractActivitySignals } from './signals/extract-activity-signals.js';
import { query } from './db.js';

async function fullExtraction() {
  const wsResult = await query('SELECT id FROM workspaces LIMIT 1');
  const workspaceId = wsResult.rows[0].id;

  console.log('=== FULL WORKSPACE EXTRACTION ===');
  console.log('This will process ALL unprocessed activities.');
  console.log('Estimated cost: ~$1.35 for 7,515 activities\n');

  const result = await extractActivitySignals(workspaceId, {
    limit: 10000  // Process up to 10K activities
  });

  console.log('\nFinal Results:');
  console.log('- Total processed:', result.processed);
  console.log('- Signals extracted:', result.extracted);
  console.log('- Skipped:', result.skipped);
  console.log('- Errors:', result.errors.length);
  console.log('- Tokens used:', result.tokens_used);
  console.log('- Duration:', (result.duration_ms / 1000).toFixed(1), 'seconds');
  console.log('- Estimated cost: $' + (result.tokens_used * 0.14 / 1_000_000).toFixed(2));

  // Final signal breakdown
  const breakdown = await query(`
    SELECT
      signal_type,
      COUNT(*) as count,
      AVG(confidence) as avg_confidence,
      COUNT(DISTINCT activity_id) as unique_activities
    FROM activity_signals
    WHERE workspace_id = $1
    GROUP BY signal_type
    ORDER BY count DESC
  `, [workspaceId]);

  console.log('\n=== Signal Type Breakdown ===');
  breakdown.rows.forEach(row => {
    console.log(`${row.signal_type.padEnd(25)} ${String(row.count).padStart(5)} signals ` +
                `(${(row.avg_confidence * 100).toFixed(0)}% avg conf, ${row.unique_activities} activities)`);
  });

  process.exit(0);
}

fullExtraction().catch(err => {
  console.error('Full extraction failed:', err);
  process.exit(1);
});
```

Run (only if ready to process everything):
```bash
npx tsx server/test-full-extraction.ts
```

---

## Success Criteria Checklist

### Phase 1: Activity Body Visibility (T001-T007)
- [ ] Dossier API includes `body` field for activities
- [ ] Frontend timeline shows "Show note" toggle for activities with body
- [ ] Stage-annotated timeline displays stage markers
- [ ] AI narrative includes activity previews
- [ ] Analysis tools scan body content for blockers/buyer signals

### Phase 2: Signal Extraction (T008-T012)
- [ ] Migrations 129, 130, 131 applied successfully
- [ ] `activity-text.ts` utils strip HTML, parse headers, classify direction
- [ ] Signal extraction runs without errors
- [ ] Signals stored in `activity_signals` table with correct types
- [ ] Untracked participants detected from CC/BCC headers (zero-cost)
- [ ] Framework signals mapped to MEDDIC/BANT/SPICED fields
- [ ] Speaker attribution works (prospect vs rep)
- [ ] `query_activity_signals` tool registered in Ask Pandora
- [ ] Chat agent can answer framework coverage questions

---

## Troubleshooting

### Issue: Migrations not applied
```bash
# Check migration status
psql $DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"

# Manually apply if needed
psql $DATABASE_URL < migrations/129_activity_signals.sql
psql $DATABASE_URL < migrations/130_activity_signal_runs.sql
psql $DATABASE_URL < migrations/131_qualification_framework_config.sql
```

### Issue: No activities have body content
Check HubSpot sync includes body field:
```bash
psql $DATABASE_URL -c "SELECT activity_type, COUNT(*), COUNT(body) FROM activities GROUP BY activity_type;"
```

### Issue: Signal extraction fails with JSON parse error
Check DeepSeek response format:
```typescript
// Add debug logging in extract-activity-signals.ts line 286
console.log('[DEBUG] DeepSeek response:', cleaned.substring(0, 500));
```

### Issue: Tool not showing in Ask Pandora
Restart dev server and check tool registration:
```bash
# Check if tool is in agent tools list
grep -n "query_activity_signals" server/chat/pandora-agent.ts
```

---

## Expected Final Stats (After Full Extraction)

Based on spec estimates:

| Metric | Expected Value |
|--------|----------------|
| Total activities | 7,515 |
| Activities with body | 7,515 (100%) |
| Body > 100 chars | 6,421 (85%) |
| Signals extracted | ~15,000-20,000 |
| framework_signal | ~3,500 |
| notable_quote | ~2,000 |
| timeline_mention | ~1,800 |
| untracked_participant | ~1,200 |
| blocker_mention | ~900 |
| buyer_signal | ~800 |
| stakeholder_mention | ~600 |
| Tokens used | ~9.8M |
| Estimated cost | $1.35 |

---

## Quick Validation Commands

```bash
# 1. Check activity body coverage
psql $DATABASE_URL -c "SELECT COUNT(*), COUNT(body), COUNT(CASE WHEN LENGTH(body) > 100 THEN 1 END) FROM activities;"

# 2. Check signal extraction progress
psql $DATABASE_URL -c "SELECT status, COUNT(*) FROM activity_signal_runs GROUP BY status;"

# 3. Check signal counts by type
psql $DATABASE_URL -c "SELECT signal_type, COUNT(*) FROM activity_signals GROUP BY signal_type ORDER BY count DESC;"

# 4. Check framework field distribution
psql $DATABASE_URL -c "SELECT framework_field, COUNT(*) FROM activity_signals WHERE signal_type = 'framework_signal' GROUP BY framework_field ORDER BY count DESC;"

# 5. Check speaker attribution
psql $DATABASE_URL -c "SELECT speaker_type, COUNT(*) FROM activity_signals GROUP BY speaker_type;"

# 6. Check extraction method split
psql $DATABASE_URL -c "SELECT extraction_method, COUNT(*) FROM activity_signals GROUP BY extraction_method;"
```

---

## Report Format

After running tests, report results as:

```
=== ACTIVITY SIGNALS TEST RESULTS ===

✅ Phase 1: Activity Body Visibility
   - Dossier API: PASS (body field present)
   - Frontend timeline: PASS (toggle works, stage markers visible)
   - AI narrative: PASS (activities included)
   - Analysis tools: PASS (body scanning works)

✅ Phase 2: Signal Extraction
   - Migrations: PASS (all 3 applied)
   - Preprocessing: PASS (5/5 tests passed)
   - Extraction: PASS (10 activities → 23 signals, 0 errors)
   - Query tool: PASS (4/4 filter tests passed)
   - Ask Pandora: PASS (5/5 chat queries successful)

Stats:
- Total activities processed: 7,515
- Total signals extracted: 18,234
- Tokens used: 9,832,000
- Actual cost: $1.38
- Extraction time: 42 minutes

Signal Breakdown:
- framework_signal: 3,621 (MEDDIC: 2,100, BANT: 921, SPICED: 600)
- notable_quote: 2,045
- timeline_mention: 1,834
- untracked_participant: 1,203
- blocker_mention: 892
- buyer_signal: 801
- stakeholder_mention: 638

Issues: None

Next Steps: Ready for production use
```
