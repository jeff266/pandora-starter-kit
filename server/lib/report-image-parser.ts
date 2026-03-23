import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
});

export interface ExtractedReportData {
  total_value:     number | null;
  deal_count:      number | null;
  stage_breakdown: Array<{ stage: string; value: number }> | null;
  filters_visible: string[];
  confidence:      'high' | 'medium' | 'low';
}

const EXTRACTION_PROMPT = `You are analyzing a screenshot of a CRM pipeline report (HubSpot, Salesforce, Excel, or similar).

Extract the following information and return ONLY a JSON object with exactly these fields:
{
  "total_value": <number or null — the total pipeline dollar value visible>,
  "deal_count": <number or null — total number of deals shown>,
  "stage_breakdown": [{ "stage": "<stage name>", "value": <dollar amount> }] or null,
  "filters_visible": ["<filter description>", ...],
  "confidence": "high" | "medium" | "low"
}

Rules:
- total_value and deal_count should be numbers without currency symbols
- If you cannot read a value clearly, set it to null
- filters_visible should list any active filters you can see (e.g., "Close Date: This Quarter", "Owner: John Smith")
- confidence: "high" if the report is clear and complete, "medium" if partially readable, "low" if unclear
- Return ONLY the JSON object, no explanation`;

export async function extractReportData(
  imageBase64: string,
  mimeType: string
): Promise<ExtractedReportData> {
  const fallback: ExtractedReportData = {
    total_value:     null,
    deal_count:      null,
    stage_breakdown: null,
    filters_visible: [],
    confidence:      'low',
  };

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as any,
              data: imageBase64,
            },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    });

    const text = response.content.find(c => c.type === 'text')?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      total_value:     typeof parsed.total_value === 'number' ? parsed.total_value : null,
      deal_count:      typeof parsed.deal_count === 'number' ? parsed.deal_count : null,
      stage_breakdown: Array.isArray(parsed.stage_breakdown) ? parsed.stage_breakdown : null,
      filters_visible: Array.isArray(parsed.filters_visible) ? parsed.filters_visible : [],
      confidence:      ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    };
  } catch (err) {
    console.error('[ReportImageParser] Extraction failed:', err instanceof Error ? err.message : err);
    return fallback;
  }
}
