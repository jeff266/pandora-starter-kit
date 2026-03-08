import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectInvokedSkills,
  inferSchedule,
  inferDelivery,
  generateAgentName,
  computeFinalConfidence,
  extractAgentFromConversation,
  type ChatMessage,
  type ScheduleSuggestion,
} from '../conversation-extractor.js';

// ─── detectInvokedSkills ──────────────────────────────────────────────────────

describe('detectInvokedSkills', () => {
  it('deduplicates repeated skill invocations', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: '', skill_id: 'pipeline-hygiene' },
      { role: 'tool', content: '', skill_id: 'pipeline-hygiene' },
      { role: 'tool', content: '', skill_id: 'forecast-rollup' },
    ];
    expect(detectInvokedSkills(messages)).toEqual(['pipeline-hygiene', 'forecast-rollup']);
  });

  it('returns empty array when no skills invoked', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    expect(detectInvokedSkills(messages)).toEqual([]);
  });

  it('detects skills from metadata.skill_id', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'done', metadata: { skill_id: 'rep-scorecard' } },
    ];
    expect(detectInvokedSkills(messages)).toEqual(['rep-scorecard']);
  });

  it('detects skills from metadata.skills_used array', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        metadata: { skills_used: [{ skill_id: 'pipeline-hygiene' }, { skill_id: 'forecast-rollup' }] },
      },
    ];
    expect(detectInvokedSkills(messages)).toEqual(['pipeline-hygiene', 'forecast-rollup']);
  });

  it('detects skills from tool_trace get_skill_evidence calls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Here is the analysis',
        tool_trace: [
          { tool: 'get_skill_evidence', input: { skill_id: 'stage-velocity-benchmarks' } },
          { tool: 'query_deals', input: {} },
        ],
      },
    ];
    expect(detectInvokedSkills(messages)).toContain('stage-velocity-benchmarks');
    expect(detectInvokedSkills(messages)).not.toContain('query_deals');
  });

  it('preserves first-appearance order', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', content: '', skill_id: 'forecast-rollup' },
      { role: 'tool', content: '', skill_id: 'pipeline-hygiene' },
      { role: 'tool', content: '', skill_id: 'forecast-rollup' },
    ];
    expect(detectInvokedSkills(messages)).toEqual(['forecast-rollup', 'pipeline-hygiene']);
  });
});

// ─── inferSchedule ────────────────────────────────────────────────────────────

describe('inferSchedule', () => {
  it('returns Monday 8 AM for weekly pipeline language', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'I want a weekly pipeline review' }];
    expect(inferSchedule(msgs).cron).toBe('0 8 * * 1');
  });

  it('returns Friday 4 PM for forecast call language', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'help me prep for my friday forecast call' }];
    expect(inferSchedule(msgs).cron).toBe('0 16 * * 5');
  });

  it('returns daily for "every morning" language', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'I check this every morning' }];
    expect(inferSchedule(msgs).cron).toBe('0 7 * * 1-5');
  });

  it('returns monthly cron for monthly language', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'show me month over month trends' }];
    expect(inferSchedule(msgs).cron).toBe('0 8 1 * *');
  });

  it('returns empty cron for quarterly language', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'this is for our QBR' }];
    expect(inferSchedule(msgs).cron).toBe('');
    expect(inferSchedule(msgs).label).toBe('On demand (quarterly)');
  });

  it('defaults to Monday 8 AM when no signal found', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'show me my pipeline' }];
    expect(inferSchedule(msgs).cron).toBe('0 8 * * 1');
  });

  it('ignores assistant messages for schedule detection', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'show me deals' },
      { role: 'assistant', content: 'Here are your daily deals' },
    ];
    expect(inferSchedule(msgs).cron).toBe('0 8 * * 1');
  });

  it('always includes a timezone', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'weekly' }];
    expect(inferSchedule(msgs).timezone).toBe('America/New_York');
  });
});

// ─── inferDelivery ────────────────────────────────────────────────────────────

describe('inferDelivery', () => {
  it('defaults to slack', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'show me pipeline' }];
    expect(inferDelivery(msgs).format).toBe('slack');
  });

  it('captures slack channel from #mention', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'send to #revenue-ops please' }];
    const result = inferDelivery(msgs);
    expect(result.format).toBe('slack');
    expect(result.channel).toBe('#revenue-ops');
  });

  it('returns email format when email is mentioned', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'can you email me this?' }];
    expect(inferDelivery(msgs).format).toBe('email');
  });
});

// ─── computeFinalConfidence ───────────────────────────────────────────────────

describe('computeFinalConfidence', () => {
  it('returns low when no skills detected', () => {
    expect(
      computeFinalConfidence('high', 10, [], 'good goal text here', ['q1', 'q2'])
    ).toBe('low');
  });

  it('returns low when conversation too short', () => {
    expect(
      computeFinalConfidence('high', 2, ['pipeline-hygiene'], 'good goal', ['q1', 'q2'])
    ).toBe('low');
  });

  it('returns low when goal is too short', () => {
    expect(
      computeFinalConfidence('high', 5, ['pipeline-hygiene'], 'short', ['q1', 'q2'])
    ).toBe('low');
  });

  it('returns low when fewer than 2 questions', () => {
    expect(
      computeFinalConfidence('high', 5, ['pipeline-hygiene'], 'ensure pipeline is healthy', ['q1'])
    ).toBe('low');
  });

  it('upgrades medium → high when structural signals are strong', () => {
    expect(
      computeFinalConfidence(
        'medium',
        8,
        ['pipeline-hygiene', 'forecast-rollup'],
        'ensure pipeline health and forecast accuracy this quarter',
        ['q1', 'q2', 'q3']
      )
    ).toBe('high');
  });

  it('passes through deepseek high without upgrade when conditions are already met', () => {
    expect(
      computeFinalConfidence(
        'high',
        5,
        ['pipeline-hygiene'],
        'ensure pipeline health is monitored weekly',
        ['q1', 'q2']
      )
    ).toBe('high');
  });
});

// ─── generateAgentName ────────────────────────────────────────────────────────

describe('generateAgentName', () => {
  it('generates a forecast name for forecast-related conversations', () => {
    const schedule: ScheduleSuggestion = {
      cron: '0 16 * * 5',
      label: 'Every Friday at 4 PM',
      timezone: 'America/New_York',
    };
    const msgs: ChatMessage[] = [{ role: 'user', content: 'I want to review my forecast commit' }];
    const name = generateAgentName('keep forecast accurate', schedule, msgs);
    expect(name).not.toBeNull();
    expect(name!.length).toBeLessThanOrEqual(40);
    expect(name).toContain('Forecast');
  });

  it('generates a pipeline name for pipeline conversations', () => {
    const schedule: ScheduleSuggestion = {
      cron: '0 8 * * 1',
      label: 'Every Monday at 8 AM',
      timezone: 'America/New_York',
    };
    const msgs: ChatMessage[] = [{ role: 'user', content: 'show me pipeline health' }];
    const name = generateAgentName('monitor pipeline health', schedule, msgs);
    expect(name).not.toBeNull();
    expect(name).toContain('Pipeline');
    expect(name!.length).toBeLessThanOrEqual(40);
  });

  it('generates a daily name for daily schedule', () => {
    const schedule: ScheduleSuggestion = {
      cron: '0 7 * * 1-5',
      label: 'Weekdays at 7 AM',
      timezone: 'America/New_York',
    };
    const msgs: ChatMessage[] = [{ role: 'user', content: 'show me rep scorecard' }];
    const name = generateAgentName('track rep attainment', schedule, msgs);
    expect(name).not.toBeNull();
    expect(name).toMatch(/^Daily/);
    expect(name!.length).toBeLessThanOrEqual(40);
  });

  it('returns null when no topic keyword matches', () => {
    const schedule: ScheduleSuggestion = {
      cron: '0 8 * * 1',
      label: 'Every Monday at 8 AM',
      timezone: 'America/New_York',
    };
    const msgs: ChatMessage[] = [{ role: 'user', content: 'just give me a summary' }];
    const name = generateAgentName('general overview', schedule, msgs);
    expect(name).toBeNull();
  });
});

// ─── extractAgentFromConversation (mocked LLM) ────────────────────────────────

vi.mock('../../utils/llm-router.js', () => ({
  callLLM: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      goal: 'Ensure pipeline health and forecast accuracy before each leadership call',
      questions: [
        'Which deals are at risk of slipping this quarter?',
        'Which reps are behind on attainment?',
        'What is the current forecast vs quota gap?',
      ],
      confidence: 'high',
    }),
    usage: { input: 200, output: 80 },
  }),
}));

describe('extractAgentFromConversation', () => {
  const baseMessages: ChatMessage[] = [
    { role: 'user', content: 'Show me pipeline health for this quarter' },
    { role: 'assistant', content: 'Here is the pipeline breakdown...' },
    {
      role: 'assistant',
      content: 'Skills invoked',
      tool_trace: [{ tool: 'get_skill_evidence', input: { skill_id: 'pipeline-hygiene' } }],
    },
    { role: 'user', content: 'Which reps are behind on attainment?' },
    { role: 'assistant', content: 'Based on the data...' },
    { role: 'user', content: 'What is the forecast gap this week?' },
    { role: 'assistant', content: 'The forecast gap is...' },
    {
      role: 'assistant',
      content: 'Forecast skills',
      tool_trace: [{ tool: 'get_skill_evidence', input: { skill_id: 'forecast-rollup' } }],
    },
    { role: 'user', content: 'I run this every Monday morning' },
    { role: 'assistant', content: 'Understood.' },
  ];

  it('returns a result with all required fields', async () => {
    const result = await extractAgentFromConversation({
      messages: baseMessages,
      workspace_id: 'ws-test',
      conversation_id: 'conv-test',
    });

    expect(result.suggested_name == null || result.suggested_name.length <= 40).toBe(true);
    expect(result.goal).toBeTruthy();
    expect(Array.isArray(result.standing_questions)).toBe(true);
    expect(Array.isArray(result.detected_skills)).toBe(true);
    expect(result.suggested_schedule).toHaveProperty('cron');
    expect(result.suggested_schedule).toHaveProperty('label');
    expect(result.suggested_schedule).toHaveProperty('timezone');
    expect(result.suggested_delivery).toHaveProperty('format');
    expect(['high', 'medium', 'low']).toContain(result.confidence);
  });

  it('detects skills deterministically', async () => {
    const result1 = await extractAgentFromConversation({
      messages: baseMessages,
      workspace_id: 'ws-test',
      conversation_id: 'conv-test',
    });
    const result2 = await extractAgentFromConversation({
      messages: baseMessages,
      workspace_id: 'ws-test',
      conversation_id: 'conv-test',
    });
    expect(result1.detected_skills).toEqual(result2.detected_skills);
  });

  it('strips internal _reasoning fields from result', async () => {
    const result = await extractAgentFromConversation({
      messages: baseMessages,
      workspace_id: 'ws-test',
      conversation_id: 'conv-test',
    });
    expect('_reasoning' in result).toBe(true);
    expect('_user_message_count' in result).toBe(true);
    expect('_deepseek_tokens_used' in result).toBe(true);
  });

  it('infers Monday schedule from "every Monday morning"', async () => {
    const result = await extractAgentFromConversation({
      messages: baseMessages,
      workspace_id: 'ws-test',
      conversation_id: 'conv-test',
    });
    expect(result.suggested_schedule.cron).toBe('0 8 * * 1');
  });
});
