import { callLLM } from '../utils/llm-router.js';
import { query } from '../db.js';
import { SkillRegistry } from '../skills/registry.js';

export interface InterpretRequest {
  step: string;
  user_input: string;
  current_draft: Record<string, any>;
  workspace_context: {
    available_skills: string[];
    crm_type: string;
    has_conversation_intel: boolean;
  };
}

export interface InterpretResponse {
  updates: Record<string, any>;
  confirmation: string;
  steps_covered: string[];
}

export async function interpretFreeText(
  workspaceId: string,
  req: InterpretRequest
): Promise<InterpretResponse> {
  const prompt = `You are the Pandora agent builder copilot. The user is on step "${req.step}" of creating an agent.

Their input: "${req.user_input}"

Current draft config: ${JSON.stringify(req.current_draft)}

Available skills: ${req.workspace_context.available_skills.join(', ')}
CRM type: ${req.workspace_context.crm_type}
Has conversation intelligence: ${req.workspace_context.has_conversation_intel}

Extract structured config from the user's input. Return JSON only:
{
  "updates": {
    "name": "string or null",
    "audience": { "role": "string", "detail_preference": "executive|manager|analyst" },
    "focus_questions": ["array of questions"],
    "suggested_skills": ["skill-id-1", "skill-id-2"],
    "schedule": { "type": "cron|manual", "cron": "cron expression or null" },
    "output_formats": ["in_app", "slack", "email"],
    "slack_channel": "#channel-name or null"
  },
  "confirmation": "Brief sentence confirming what you understood",
  "steps_covered": ["audience", "focus"]
}

Rules:
- Only include fields the user actually mentioned
- If the input is ambiguous, make your best guess and note it in confirmation
- Map informal language to formal config (e.g., "my boss" -> executive audience)
- If the user describes a complete agent in one sentence, fill everything you can
- Keep confirmation under 30 words
- For schedule, use standard cron format (minute hour day-of-month month day-of-week)
- steps_covered should list which steps (welcome, audience, focus, skills, schedule, delivery) this input addresses`;

  try {
    const response = await callLLM(workspaceId, 'extract', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
      temperature: 0,
    });

    const text = response.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        updates: {},
        confirmation: "I understood your input but couldn't extract specific config. Could you try again?",
        steps_covered: [],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.updates?.suggested_skills) {
      parsed.updates.skills = parsed.updates.suggested_skills;
      delete parsed.updates.suggested_skills;
    }

    const cleanUpdates: Record<string, any> = {};
    for (const [key, val] of Object.entries(parsed.updates || {})) {
      if (val !== null && val !== undefined) {
        cleanUpdates[key] = val;
      }
    }

    return {
      updates: cleanUpdates,
      confirmation: parsed.confirmation || 'Got it.',
      steps_covered: parsed.steps_covered || [req.step],
    };
  } catch (err: any) {
    console.error('[Copilot] Interpretation failed:', err.message);
    return {
      updates: {},
      confirmation: "I had trouble understanding that. Could you rephrase, or pick one of the options?",
      steps_covered: [],
    };
  }
}

export async function getWorkspaceCopilotContext(workspaceId: string) {
  const registry = SkillRegistry.getInstance();
  const allSkills = registry.listAll().map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
  }));

  const [workspaceResult, connectorResult] = await Promise.all([
    query('SELECT settings FROM workspaces WHERE id = $1', [workspaceId]),
    query(
      "SELECT connector_type FROM workspace_connectors WHERE workspace_id = $1 AND status = 'active'",
      [workspaceId]
    ),
  ]);

  const connectors = connectorResult.rows.map((r: any) => r.connector_type);
  const hasCrmType = connectors.find((c: string) => ['hubspot', 'salesforce'].includes(c));
  const hasConvoIntel = connectors.some((c: string) => ['gong', 'fireflies'].includes(c));
  const hasSlack = connectors.includes('slack') || !!process.env.SLACK_BOT_TOKEN;

  return {
    skills: allSkills,
    crm_type: hasCrmType || 'unknown',
    has_slack: hasSlack,
    has_conversation_intel: hasConvoIntel,
  };
}
