/**
 * E2E Smoke Test — calls every tool's execute() against the Frontera workspace
 * Usage: npx tsx server/tests/smoke-test-tools.ts
 */
import { toolRegistry } from '../skills/tool-definitions.js';
import type { ToolDefinition } from '../skills/types.js';

const WS = '4160191d-73bc-414b-97dd-5a1853190378';

const SAMPLE_DEAL = '16b1b0ba-c7c4-484e-8042-978efe37294b';
const SAMPLE_CONTACT = '02b90e4a-4cd1-417d-8d3b-55ef5292ee3e';
const SAMPLE_ACCOUNT = '9d90a54c-09b0-4eff-9f98-d41e249b8a9f';
const SAMPLE_CONVERSATION = '228467df-8322-4b38-b837-e64986540b4d';

const paramOverrides: Record<string, Record<string, any>> = {
  getDeal: { dealId: SAMPLE_DEAL },
  getDealsClosingInRange: { startDate: '2025-01-01', endDate: '2026-12-31' },
  getContact: { contactId: SAMPLE_CONTACT },
  getContactsForDeal: { dealId: SAMPLE_DEAL },
  getAccount: { accountId: SAMPLE_ACCOUNT },
  getAccountHealth: { accountId: SAMPLE_ACCOUNT },
  getActivityTimeline: { dealId: SAMPLE_DEAL },
  getConversation: { conversationId: SAMPLE_CONVERSATION },
  getRecentCallsForDeal: { dealId: SAMPLE_DEAL },
  getDocument: { documentId: 'nonexistent' },
  getDocumentsForDeal: { dealId: SAMPLE_DEAL },
  resolveTimeWindows: {
    analysisWindow: 'current_quarter',
    changeWindow: 'since_last_run',
    trendComparison: 'previous_period',
  },
  getDealRiskScore: { dealId: SAMPLE_DEAL },
};

interface TestResult {
  tool: string;
  status: 'pass' | 'fail' | 'error';
  error?: string;
  resultKeys?: number;
  durationMs: number;
}

async function runTool(name: string, def: ToolDefinition): Promise<TestResult> {
  const start = Date.now();
  const params = paramOverrides[name] || {};
  const context = {
    workspaceId: WS,
    timeWindows: {
      analysisStart: '2025-01-01',
      analysisEnd: '2026-12-31',
      changeStart: '2025-01-01',
      previousStart: '2024-01-01',
      previousEnd: '2024-12-31',
    },
    stepOutputs: {},
    skillOutputs: {},
    businessContext: {},
  };

  try {
    const result = await def.execute(params, context as any);
    const dur = Date.now() - start;

    if (result && typeof result === 'object' && 'error' in result) {
      return { tool: name, status: 'fail', error: (result as any).error, durationMs: dur };
    }

    const keys = Array.isArray(result)
      ? result.length
      : typeof result === 'object' && result !== null
        ? Object.keys(result).length
        : 1;

    return { tool: name, status: 'pass', resultKeys: keys, durationMs: dur };
  } catch (err: any) {
    return {
      tool: name,
      status: 'error',
      error: err.message || String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function main() {
  console.log(`\n=== Pandora Tool Smoke Test ===`);
  console.log(`Workspace: Frontera Health (${WS})`);
  console.log(`Tools in registry: ${toolRegistry.size}\n`);

  const results: TestResult[] = [];

  const entries = Array.from(toolRegistry.entries());
  for (const [name, def] of entries) {
    process.stdout.write(`  ${name} ... `);
    const r = await runTool(name, def);
    results.push(r);
    if (r.status === 'pass') {
      console.log(`✓  (${r.resultKeys} keys, ${r.durationMs}ms)`);
    } else {
      console.log(`✗  ${r.error}  (${r.durationMs}ms)`);
    }
  }

  console.log(`\n=== Summary ===`);
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status !== 'pass');
  console.log(`Passed: ${passed.length}/${results.length}`);
  console.log(`Failed: ${failed.length}/${results.length}`);

  if (failed.length > 0) {
    console.log(`\n=== Failures ===`);
    for (const f of failed) {
      console.log(`  [${f.status.toUpperCase()}] ${f.tool}: ${f.error}`);
    }
  }

  console.log(`\nTotal duration: ${results.reduce((s, r) => s + r.durationMs, 0)}ms`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
