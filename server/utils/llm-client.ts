import Anthropic from "@anthropic-ai/sdk";

export interface ClaudeConfig {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;

  constructor(config: ClaudeConfig = {}) {
    const apiKey =
      config.apiKey ||
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY;

    const baseURL =
      config.baseURL || process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;

    if (!apiKey) {
      throw new Error(
        "Anthropic API key required: set ANTHROPIC_API_KEY or use Replit AI integration",
      );
    }

    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    this.model = config.model || "claude-sonnet-4-5";
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 8192,
    });

    const block = response.content[0];
    if (block.type === "text") {
      return block.text;
    }

    return "";
  }

  async callStructured<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<T> {
    const response = await this.call(systemPrompt, userPrompt, options);
    return this.parseJsonResponse<T>(response);
  }

  private parseJsonResponse<T>(text: string): T {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    const codeBlockMatch = text.match(/```\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }

    return JSON.parse(text);
  }
}

export function createClaudeClient(
  apiKey?: string,
  model?: string,
): ClaudeClient {
  return new ClaudeClient({ apiKey, model });
}
