import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';
import {
  analyzePayload,
  estimateCost,
  generateRecommendations,
  trackTokenUsage,
  type TrackingContext,
} from '../lib/token-tracker.js';

export type LLMCapability = 'extract' | 'reason' | 'generate' | 'classify';

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: {
    input: number;
    output: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
}

export interface LLMCallOptions {
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: any; toolCallId?: string }>;
  tools?: ToolDef[];
  schema?: Record<string, any>;
  maxTokens?: number;
  temperature?: number;
  _tracking?: TrackingContext;
}

export type { TrackingContext };

interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  enabled: boolean;
}

interface LLMConfig {
  providers: Record<string, ProviderConfig>;
  routing: Record<string, string>;
  default_token_budget: number;
  tokens_used_this_month: number;
}

interface CacheEntry {
  config: LLMConfig;
  loadedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const configCache = new Map<string, CacheEntry>();

async function loadConfig(workspaceId: string): Promise<LLMConfig> {
  const cached = configCache.get(workspaceId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const result = await query<{
    providers: any;
    routing: any;
    default_token_budget: number;
    tokens_used_this_month: number;
  }>(
    `SELECT providers, routing, default_token_budget, tokens_used_this_month
     FROM llm_configs WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    const defaultConfig: LLMConfig = {
      providers: {},
      routing: {
        extract: 'fireworks/deepseek-v3p1',
        reason: 'anthropic/claude-sonnet-4-20250514',
        generate: 'anthropic/claude-sonnet-4-20250514',
        classify: 'fireworks/deepseek-v3p1',
      },
      default_token_budget: 50000,
      tokens_used_this_month: 0,
    };
    configCache.set(workspaceId, { config: defaultConfig, loadedAt: Date.now() });
    return defaultConfig;
  }

  const row = result.rows[0];
  const config: LLMConfig = {
    providers: row.providers || {},
    routing: row.routing || {},
    default_token_budget: row.default_token_budget,
    tokens_used_this_month: row.tokens_used_this_month,
  };

  configCache.set(workspaceId, { config, loadedAt: Date.now() });
  return config;
}

function resolveProvider(config: LLMConfig, capability: LLMCapability): { provider: string; model: string } {
  const route = config.routing[capability];
  if (!route) {
    throw new Error(`No routing configured for capability '${capability}'`);
  }

  const slashIndex = route.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(`Invalid routing format '${route}' — expected 'provider/model'`);
  }

  return {
    provider: route.substring(0, slashIndex),
    model: route.substring(slashIndex + 1),
  };
}

function getApiKey(config: LLMConfig, provider: string): { apiKey: string; baseURL?: string } {
  const workspaceProvider = config.providers[provider];
  if (workspaceProvider?.enabled && workspaceProvider?.apiKey) {
    return { apiKey: workspaceProvider.apiKey, baseURL: workspaceProvider.baseURL };
  }

  switch (provider) {
    case 'anthropic':
      return {
        apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || '',
      };
    case 'fireworks':
      return {
        apiKey: process.env.FIREWORKS_API_KEY || '',
        baseURL: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
      };
    case 'openai':
      return {
        apiKey: process.env.OPENAI_API_KEY || '',
      };
    default:
      throw new Error(`Unknown provider '${provider}' — no platform key configured`);
  }
}

function toolsToAnthropic(tools: ToolDef[]): any[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function toolsToOpenAI(tools: ToolDef[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function messagesToAnthropic(
  messages: LLMCallOptions['messages']
): Array<{ role: string; content: any }> {
  const result: Array<{ role: string; content: any }> = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const lastMsg = result[result.length - 1];
      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
        lastMsg.content.push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      } else {
        result.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          }],
        });
      }
    } else if (msg.role === 'assistant' && msg.content && typeof msg.content !== 'string') {
      result.push({ role: 'assistant', content: msg.content });
    } else {
      result.push({
        role: msg.role === 'tool' ? 'user' : msg.role,
        content: msg.content,
      });
    }
  }

  return result;
}

function messagesToOpenAI(
  messages: LLMCallOptions['messages'],
  systemPrompt?: string
): any[] {
  const result: any[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const textParts = msg.content.filter((b: any) => b.type === 'text');
      const toolParts = msg.content.filter((b: any) => b.type === 'tool_use');
      const assistantMsg: any = {
        role: 'assistant',
        content: textParts.map((b: any) => b.text).join('\n') || null,
      };
      if (toolParts.length > 0) {
        assistantMsg.tool_calls = toolParts.map((t: any) => ({
          id: t.id,
          type: 'function',
          function: {
            name: t.name,
            arguments: JSON.stringify(t.input),
          },
        }));
      }
      result.push(assistantMsg);
    } else {
      result.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  return result;
}

function parseAnthropicResponse(response: any): LLMResponse {
  const textBlocks = (response.content || []).filter((b: any) => b.type === 'text');
  const toolBlocks = (response.content || []).filter((b: any) => b.type === 'tool_use');

  const content = textBlocks.map((b: any) => b.text).join('\n');
  const toolCalls: ToolCall[] = toolBlocks.map((b: any) => ({
    id: b.id,
    name: b.name,
    input: b.input,
  }));

  let stopReason: LLMResponse['stopReason'] = 'end_turn';
  if (response.stop_reason === 'tool_use') stopReason = 'tool_use';
  else if (response.stop_reason === 'max_tokens') stopReason = 'max_tokens';

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason,
    usage: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
      cacheCreation: response.usage?.cache_creation_input_tokens || 0,
      cacheRead: response.usage?.cache_read_input_tokens || 0,
    },
  };
}

function parseOpenAIResponse(response: any): LLMResponse {
  const choice = response.choices?.[0];
  if (!choice) {
    return { content: '', stopReason: 'end_turn', usage: { input: 0, output: 0 } };
  }

  const message = choice.message;
  const content = message?.content || '';

  const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}'),
  }));

  let stopReason: LLMResponse['stopReason'] = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
  else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason,
    usage: {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
    },
  };
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(apiKey: string, baseURL?: string): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return anthropicClient;
}

async function callAnthropic(
  model: string,
  options: LLMCallOptions,
  apiKey: string,
  baseURL?: string
): Promise<LLMResponse> {
  const client = getAnthropicClient(apiKey, baseURL);

  const anthropicModel = model === 'claude-sonnet-4-20250514' ? 'claude-sonnet-4-5' : model;

  const requestBody: any = {
    model: anthropicModel,
    messages: messagesToAnthropic(options.messages),
    max_tokens: options.maxTokens || 4096,
    temperature: options.temperature ?? 0.7,
  };

  if (options.systemPrompt) {
    requestBody.system = [
      {
        type: 'text',
        text: options.systemPrompt,
        cache_control: { type: 'ephemeral' }
      }
    ];
  }

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = toolsToAnthropic(options.tools);
  }

  const response = await client.messages.create(requestBody);
  if (response.usage) {
    const cacheCreate = (response.usage as any).cache_creation_input_tokens || 0;
    const cacheRead = (response.usage as any).cache_read_input_tokens || 0;
    if (cacheCreate > 0 || cacheRead > 0) {
      console.log(`[Cache] ${model}: cache_create=${cacheCreate}, cache_read=${cacheRead}, input=${response.usage.input_tokens}`);
    }
  }
  return parseAnthropicResponse(response);
}

async function callOpenAICompatible(
  model: string,
  options: LLMCallOptions,
  apiKey: string,
  baseURL: string,
  provider: string
): Promise<LLMResponse> {
  const effectiveModel = provider === 'fireworks'
    ? `accounts/fireworks/models/${model}`
    : model;

  const requestBody: any = {
    model: effectiveModel,
    messages: messagesToOpenAI(options.messages, options.systemPrompt),
    max_tokens: options.maxTokens || 4096,
    temperature: options.temperature ?? 0.1,
  };

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = toolsToOpenAI(options.tools);
  }

  if (options.schema) {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${provider} API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return parseOpenAIResponse(data);
}

async function trackUsage(workspaceId: string, tokens: number): Promise<void> {
  try {
    await query(
      `UPDATE llm_configs
       SET updated_at = NOW(),
           budget_reset_at = CASE
             WHEN budget_reset_at <= NOW()
             THEN date_trunc('month', NOW()) + INTERVAL '1 month'
             ELSE budget_reset_at
           END,
           tokens_used_this_month = CASE
             WHEN budget_reset_at <= NOW() THEN $2
             ELSE tokens_used_this_month + $2
           END
       WHERE workspace_id = $1`,
      [workspaceId, tokens]
    );
  } catch (err) {
    console.error('[LLM Router] Failed to track usage:', err);
  }
}

export function clearConfigCache(workspaceId?: string): void {
  if (workspaceId) {
    configCache.delete(workspaceId);
  } else {
    configCache.clear();
  }
}

export function assistantMessageFromResponse(response: LLMResponse): any {
  if (response.toolCalls && response.toolCalls.length > 0) {
    const blocks: any[] = [];
    if (response.content) {
      blocks.push({ type: 'text', text: response.content });
    }
    for (const tc of response.toolCalls) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    return { role: 'assistant', content: blocks };
  }
  return { role: 'assistant', content: response.content };
}

export function toolResultMessage(toolCallId: string, result: any): LLMCallOptions['messages'][0] {
  return {
    role: 'tool',
    content: typeof result === 'string' ? result : JSON.stringify(result),
    toolCallId,
  };
}

export async function callLLM(
  workspaceId: string,
  capability: LLMCapability,
  options: LLMCallOptions
): Promise<LLMResponse> {
  const config = await loadConfig(workspaceId);
  const { provider, model } = resolveProvider(config, capability);
  const { apiKey, baseURL } = getApiKey(config, provider);

  if (!apiKey) {
    throw new Error(
      `No API key for provider '${provider}' — add a key to workspace LLM config or set platform env var`
    );
  }

  console.log(`[LLM Router] ${capability} → ${provider}/${model}`);

  const allMessages: Array<{ role: string; content: any }> = [];
  if (options.systemPrompt) {
    allMessages.push({ role: 'system', content: options.systemPrompt });
  }
  for (const m of options.messages) {
    allMessages.push({ role: m.role, content: m.content });
  }
  const payloadSummary = analyzePayload(allMessages);
  const promptChars = payloadSummary.totalChars;

  const startTime = Date.now();

  let response: LLMResponse;

  switch (provider) {
    case 'anthropic':
      response = await callAnthropic(model, options, apiKey, baseURL);
      break;
    case 'fireworks':
    case 'openai':
      response = await callOpenAICompatible(
        model,
        options,
        apiKey,
        baseURL || (provider === 'fireworks'
          ? 'https://api.fireworks.ai/inference/v1'
          : 'https://api.openai.com/v1'),
        provider
      );
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  const latencyMs = Date.now() - startTime;
  const totalTokens = response.usage.input + response.usage.output;
  await trackUsage(workspaceId, totalTokens);

  const tracking = options._tracking;
  const costUsd = estimateCost(model, response.usage.input, response.usage.output);
  const recommendations = generateRecommendations(totalTokens, costUsd, payloadSummary);

  trackTokenUsage({
    workspaceId: tracking?.workspaceId || workspaceId,
    skillId: tracking?.skillId,
    skillRunId: tracking?.skillRunId,
    phase: tracking?.phase,
    stepName: tracking?.stepName,
    provider,
    model,
    inputTokens: response.usage.input,
    outputTokens: response.usage.output,
    estimatedCostUsd: costUsd,
    promptChars,
    responseChars: response.content.length,
    truncated: false,
    payloadSummary,
    latencyMs,
    recommendations,
  }).catch(err => console.warn('[Token Tracker] Fire-and-forget failed:', err.message));

  return response;
}

export async function getLLMConfig(workspaceId: string): Promise<{
  routing: Record<string, string>;
  providers: Record<string, { connected: boolean }>;
  budget: { total: number; used: number; remaining: number };
}> {
  const config = await loadConfig(workspaceId);

  const providers: Record<string, { connected: boolean }> = {};
  for (const [name, p] of Object.entries(config.providers)) {
    providers[name] = { connected: p.enabled && !!p.apiKey };
  }

  const platformProviders = ['anthropic', 'fireworks'];
  for (const name of platformProviders) {
    if (!providers[name]) {
      const { apiKey } = getApiKey(config, name);
      providers[name] = { connected: !!apiKey };
    }
  }

  return {
    routing: config.routing,
    providers,
    budget: {
      total: config.default_token_budget,
      used: config.tokens_used_this_month,
      remaining: Math.max(0, config.default_token_budget - config.tokens_used_this_month),
    },
  };
}

export async function updateLLMConfig(
  workspaceId: string,
  updates: {
    routing?: Record<string, string>;
    providers?: Record<string, { apiKey?: string; baseURL?: string; enabled?: boolean }>;
    default_token_budget?: number;
  }
): Promise<void> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const values: any[] = [workspaceId];
  let paramIdx = 2;

  if (updates.routing) {
    setClauses.push(`routing = $${paramIdx}`);
    values.push(JSON.stringify(updates.routing));
    paramIdx++;
  }

  if (updates.providers) {
    setClauses.push(`providers = $${paramIdx}`);
    values.push(JSON.stringify(updates.providers));
    paramIdx++;
  }

  if (updates.default_token_budget !== undefined) {
    setClauses.push(`default_token_budget = $${paramIdx}`);
    values.push(updates.default_token_budget);
    paramIdx++;
  }

  await query(
    `UPDATE llm_configs SET ${setClauses.join(', ')} WHERE workspace_id = $1`,
    values
  );

  clearConfigCache(workspaceId);
}

// Claude pricing per 1M tokens (MTok)
const CLAUDE_PRICING = {
  input: 3.00,            // $3 per MTok input
  output: 15.00,          // $15 per MTok output
  cacheWrite: 3.75,       // $3.75 per MTok cache write (25% premium)
  cacheRead: 0.30,        // $0.30 per MTok cache read (90% discount)
};

const DEEPSEEK_PRICING = {
  input: 0.14,            // $0.14 per MTok
  output: 0.28,           // $0.28 per MTok
};

export function estimateCost(usage: {
  claude?: number;
  deepseek?: number;
  claudeCacheCreation?: number;
  claudeCacheRead?: number;
  claudeOutput?: number;
  deepseekOutput?: number;
}): number {
  let cost = 0;

  // Claude costs with caching
  if (usage.claude) {
    // Assume 40% input, 60% output split if not specified
    const inputTokens = usage.claudeOutput
      ? (usage.claude - usage.claudeOutput)
      : usage.claude * 0.4;
    const outputTokens = usage.claudeOutput || usage.claude * 0.6;

    cost += (inputTokens / 1_000_000) * CLAUDE_PRICING.input;
    cost += (outputTokens / 1_000_000) * CLAUDE_PRICING.output;
  }

  // Cache creation cost (25% premium over normal input)
  if (usage.claudeCacheCreation) {
    cost += (usage.claudeCacheCreation / 1_000_000) * CLAUDE_PRICING.cacheWrite;
  }

  // Cache read cost (90% discount)
  if (usage.claudeCacheRead) {
    cost += (usage.claudeCacheRead / 1_000_000) * CLAUDE_PRICING.cacheRead;
  }

  // DeepSeek costs
  if (usage.deepseek) {
    const inputTokens = usage.deepseekOutput
      ? (usage.deepseek - usage.deepseekOutput)
      : usage.deepseek * 0.4;
    const outputTokens = usage.deepseekOutput || usage.deepseek * 0.6;

    cost += (inputTokens / 1_000_000) * DEEPSEEK_PRICING.input;
    cost += (outputTokens / 1_000_000) * DEEPSEEK_PRICING.output;
  }

  return cost;
}

export async function getLLMUsage(workspaceId: string): Promise<{
  tokensUsedThisMonth: number;
  budget: number;
  remaining: number;
  resetAt: string | null;
  perSkill: Array<{ skillId: string; totalTokens: number; runCount: number }>;
  caching?: {
    totalCacheReads: number;
    totalCacheWrites: number;
    estimatedSavings: number;
    cacheHitRate: number;
  };
}> {
  const config = await loadConfig(workspaceId);

  const skillUsage = await query<{ skill_id: string; total_tokens: string; run_count: string }>(
    `SELECT skill_id,
            SUM((token_usage->>'claude')::int + (token_usage->>'deepseek')::int + (token_usage->>'compute')::int) AS total_tokens,
            COUNT(*) AS run_count
     FROM skill_runs
     WHERE workspace_id = $1
       AND created_at >= date_trunc('month', NOW())
       AND status = 'completed'
     GROUP BY skill_id
     ORDER BY total_tokens DESC`,
    [workspaceId]
  );

  const resetResult = await query<{ budget_reset_at: string }>(
    `SELECT budget_reset_at::text FROM llm_configs WHERE workspace_id = $1`,
    [workspaceId]
  );

  // Calculate cache statistics
  const cacheStats = await query<{
    total_cache_reads: string;
    total_cache_writes: string;
    total_claude_tokens: string;
  }>(
    `SELECT
      COALESCE(SUM((token_usage->>'claudeCacheRead')::int), 0) AS total_cache_reads,
      COALESCE(SUM((token_usage->>'claudeCacheCreation')::int), 0) AS total_cache_writes,
      COALESCE(SUM((token_usage->>'claude')::int), 0) AS total_claude_tokens
     FROM skill_runs
     WHERE workspace_id = $1
       AND created_at >= date_trunc('month', NOW())
       AND status = 'completed'`,
    [workspaceId]
  );

  const cacheReads = parseInt(cacheStats.rows[0]?.total_cache_reads || '0', 10);
  const cacheWrites = parseInt(cacheStats.rows[0]?.total_cache_writes || '0', 10);
  const claudeTokens = parseInt(cacheStats.rows[0]?.total_claude_tokens || '0', 10);

  // Estimate savings: cache reads would have cost 10x more without caching
  const cacheSavings = (cacheReads / 1_000_000) * (CLAUDE_PRICING.input - CLAUDE_PRICING.cacheRead);
  const cacheHitRate = claudeTokens > 0 ? cacheReads / claudeTokens : 0;

  return {
    tokensUsedThisMonth: config.tokens_used_this_month,
    budget: config.default_token_budget,
    remaining: Math.max(0, config.default_token_budget - config.tokens_used_this_month),
    resetAt: resetResult.rows[0]?.budget_reset_at || null,
    perSkill: skillUsage.rows.map(r => ({
      skillId: r.skill_id,
      totalTokens: parseInt(r.total_tokens, 10) || 0,
      runCount: parseInt(r.run_count, 10) || 0,
    })),
    caching: cacheReads > 0 || cacheWrites > 0 ? {
      totalCacheReads: cacheReads,
      totalCacheWrites: cacheWrites,
      estimatedSavings: cacheSavings,
      cacheHitRate,
    } : undefined,
  };
}
