/**
 * Test: Activity Text Preprocessing Utility
 * Run: npx tsx server/test-activity-text.ts
 *
 * Verifies all functions in server/utils/activity-text.ts
 */

import {
  stripHtml,
  stripReplyThreads,
  parseEmailHeaders,
  classifyEmailParticipants,
  cleanActivityBody,
  activityPreview,
} from './utils/activity-text.js';
import { query } from './db.js';

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, actual: any, expected: any): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function testContains(name: string, actual: string, substr: string): void {
  const ok = actual.includes(substr);
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     expected to contain: "${substr}"`);
    console.log(`     actual: "${actual.slice(0, 200)}"`);
    failed++;
  }
}

function testNotContains(name: string, actual: string, substr: string): void {
  const ok = !actual.includes(substr);
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     expected NOT to contain: "${substr}"`);
    console.log(`     actual: "${actual.slice(0, 200)}"`);
    failed++;
  }
}

// ─── 1. stripHtml ────────────────────────────────────────────────────────────

console.log('\n1. stripHtml');

test(
  'removes basic tags',
  stripHtml('<p>Hello <b>world</b></p>'),
  'Hello world'
);

test(
  'decodes &amp;',
  stripHtml('AT&amp;T'),
  'AT&T'
);

test(
  'decodes &lt; and &gt;',
  stripHtml('if a &lt; b &gt; c'),
  'if a < b > c'
);

test(
  'decodes &nbsp;',
  stripHtml('foo&nbsp;bar'),
  'foo bar'
);

test(
  'normalizes whitespace',
  stripHtml('<p>  too   many   spaces  </p>'),
  'too many spaces'
);

test(
  'handles nested HTML',
  stripHtml('<div><h3><strong>Title</strong></h3><p>Body text here</p></div>'),
  'Title Body text here'
);

test(
  'returns empty string for empty input',
  stripHtml(''),
  ''
);

// ─── 2. stripReplyThreads ────────────────────────────────────────────────────

console.log('\n2. stripReplyThreads');

testNotContains(
  'removes <blockquote> and content',
  stripReplyThreads('<p>Latest reply here</p><blockquote>On Jan 15 Sara wrote: old content</blockquote>'),
  'old content'
);

testContains(
  'keeps content above <blockquote>',
  stripReplyThreads('<p>Latest reply here</p><blockquote>old content</blockquote>'),
  'Latest reply here'
);

testNotContains(
  'removes "On X wrote:" chain',
  stripReplyThreads('New content here.\nOn Mon, Jan 13, 2026 at 2:00 PM John Smith <john@company.com> wrote:\n> Old quoted text'),
  'Old quoted text'
);

testContains(
  'keeps content before "On X wrote:"',
  stripReplyThreads('New content here.\nOn Mon, Jan 13, 2026 wrote:\n> Old quoted text'),
  'New content here'
);

testNotContains(
  'removes -----Original Message----- block',
  stripReplyThreads('Latest message.\n-----Original Message-----\nFrom: someone@old.com\nSubject: old'),
  'old.com'
);

// ─── 3. parseEmailHeaders ────────────────────────────────────────────────────

console.log('\n3. parseEmailHeaders');

const emailBody = `To: yolanda.fernandez@moeveglobal.com; chelsea.dabney@imubit.com
CC: accounting@imubit.com; andres.gutierrez@moeveglobal.com; jesus.gomez@moeveglobal.com
BCC: 
Attachment: --none--
Subject: Re: Natrium Optimization
Body:
Russ, thank you for the update. February is open for us.`;

const parsed = parseEmailHeaders(emailBody);

test('detects email headers', parsed.hasHeaders, true);
test('parses To: field', parsed.to, ['yolanda.fernandez@moeveglobal.com', 'chelsea.dabney@imubit.com']);
test('parses CC: field', parsed.cc, ['accounting@imubit.com', 'andres.gutierrez@moeveglobal.com', 'jesus.gomez@moeveglobal.com']);
test('parses empty BCC: field', parsed.bcc, []);
test('parses Subject:', parsed.subject, 'Re: Natrium Optimization');
testContains('extracts body text', parsed.bodyText, 'Russ, thank you');

const nonEmail = parseEmailHeaders('<p>Just a regular note</p>');
test('returns hasHeaders=false for non-email', nonEmail.hasHeaders, false);
testContains('returns full body for non-email', nonEmail.bodyText, 'Just a regular note');

// ─── 4. classifyEmailParticipants ────────────────────────────────────────────

console.log('\n4. classifyEmailParticipants');

const participants = classifyEmailParticipants(parsed, 'imubit.com');

test('detects outbound direction (To = customer domain)', participants.direction, 'outbound');
testContains('finds prospect addresses', participants.prospectAddresses.join(','), 'moeveglobal.com');
testContains('finds internal address in CC', participants.internalAddresses.join(','), 'imubit.com');

const inboundHeaders = parseEmailHeaders(`To: rep@imubit.com; rep2@imubit.com
CC: customer@moeveglobal.com
BCC:
Subject: Following up
Body: Hi team, just wanted to check in.`);

const inboundParticipants = classifyEmailParticipants(inboundHeaders, 'imubit.com');
test('detects inbound direction (To = rep domain)', inboundParticipants.direction, 'inbound');

// ─── 5. cleanActivityBody + activityPreview ──────────────────────────────────

console.log('\n5. cleanActivityBody + activityPreview');

testContains(
  'cleanActivityBody for email extracts body text',
  cleanActivityBody(emailBody, 'email'),
  'Russ, thank you'
);

testNotContains(
  'cleanActivityBody for email strips To: headers',
  cleanActivityBody(emailBody, 'email'),
  'To: yolanda'
);

const htmlNote = '<div><h3><strong>Meeting Notes</strong></h3><p>Customer said they need it by Q3 for &amp; annual planning</p></div>';
testContains(
  'cleanActivityBody for note strips HTML',
  cleanActivityBody(htmlNote, 'note'),
  'Customer said they need it by Q3'
);

testContains(
  'cleanActivityBody decodes entities in notes',
  cleanActivityBody(htmlNote, 'note'),
  '& annual planning'
);

const longText = 'A'.repeat(500);
const preview = activityPreview(longText, 100);
test('activityPreview truncates to maxChars + ellipsis', preview.length, 101);
testContains('activityPreview ends with ellipsis', preview, '…');

const shortText = 'Short note';
test('activityPreview does not truncate short text', activityPreview(shortText, 100), shortText);

// ─── 6. Real activities from DB ──────────────────────────────────────────────

console.log('\n6. Real activities from DB');

async function testRealActivities() {
  const fronteraWorkspace = '4160191d-73bc-414b-97dd-5a1853190378';
  const emailWorkspace = '31551fe0-b746-4384-aab2-d5cdd70b19ed';

  const noteResult = await query<{ body: string; activity_type: string }>(
    `SELECT body, activity_type FROM activities
     WHERE workspace_id = $1 AND body IS NOT NULL AND LENGTH(body) > 200
     ORDER BY LENGTH(body) DESC LIMIT 3`,
    [fronteraWorkspace]
  );

  console.log(`  Found ${noteResult.rows.length} notes from Frontera workspace:`);
  for (const row of noteResult.rows) {
    const cleaned = cleanActivityBody(row.body, row.activity_type);
    const ok = cleaned.length > 10 && !cleaned.includes('<div') && !cleaned.includes('</p>');
    if (ok) {
      console.log(`  ✅ cleanActivityBody: ${cleaned.slice(0, 80)}…`);
      passed++;
    } else {
      console.log(`  ❌ cleanActivityBody left HTML: ${cleaned.slice(0, 80)}`);
      failed++;
    }
  }

  const emailResult = await query<{ body: string; activity_type: string }>(
    `SELECT body, activity_type FROM activities
     WHERE workspace_id = $1 AND activity_type = 'email' AND body IS NOT NULL LIMIT 3`,
    [emailWorkspace]
  );

  console.log(`  Found ${emailResult.rows.length} email activities from email workspace:`);
  for (const row of emailResult.rows) {
    const headers = parseEmailHeaders(row.body || '');
    if (headers.hasHeaders) {
      console.log(`  ✅ Email has headers: To=${headers.to[0] || 'none'}, CC=${headers.cc.length} addresses`);
      passed++;
    } else {
      console.log(`  ⚠️  Email activity has no parseable headers (may be plain text already)`);
    }
  }
}

await testRealActivities();

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ All tests passed!');
} else {
  console.log('❌ Some tests failed — check output above');
  process.exit(1);
}

process.exit(0);
