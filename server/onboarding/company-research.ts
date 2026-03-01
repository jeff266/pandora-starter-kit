import { callLLM } from '../utils/llm-router.js';
import type { CompanyResearch } from './types.js';

const SERPER_URL = 'https://google.serper.dev/search';
const SERPER_KEY = process.env.SERPER_API_KEY || '';

interface SerperResult {
  title: string;
  snippet: string;
  link: string;
}

async function serperSearch(query: string): Promise<SerperResult[]> {
  if (!SERPER_KEY) return [];
  try {
    const res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 3 }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { organic?: SerperResult[] };
    return (data.organic || []).slice(0, 3);
  } catch {
    return [];
  }
}

const STUB: CompanyResearch = {
  company_size_estimate: 'unknown',
  industry: 'unknown',
  likely_gtm_motion: 'unknown',
  pricing_model: 'unknown',
  competitors: [],
  funding_stage: 'unknown',
  confidence: 0,
  evidence_urls: [],
};

export async function researchCompany(companyName: string): Promise<CompanyResearch> {
  if (!SERPER_KEY || !companyName || companyName === 'unknown') return STUB;

  const queries = [
    `"${companyName}" sales team size`,
    `"${companyName}" SaaS pricing model`,
    `"${companyName}" G2 reviews competitors`,
    `"${companyName}" LinkedIn company`,
    `"${companyName}" funding revenue`,
  ];

  const results = await Promise.all(queries.map(q => serperSearch(q)));
  const evidence_urls = results.flat().map(r => r.link).filter(Boolean).slice(0, 10);

  const searchBlob = results.map((res, i) =>
    `Query: ${queries[i]}\n${res.map(r => `${r.title}: ${r.snippet}`).join('\n')}`
  ).join('\n\n');

  if (!searchBlob.trim()) return STUB;

  const prompt = `You are analyzing search results about a company called "${companyName}" for a sales intelligence platform.

Based on these search results, extract company information:

${searchBlob.slice(0, 4000)}

Return a JSON object with these exact fields:
{
  "company_size_estimate": "e.g. 50-200 employees",
  "industry": "e.g. Healthcare Technology",
  "likely_gtm_motion": "e.g. enterprise, mid-market, SMB, or hybrid",
  "pricing_model": "e.g. annual SaaS, usage-based, seat-based",
  "competitors": ["Competitor A", "Competitor B"],
  "funding_stage": "e.g. Series B, bootstrapped, public",
  "confidence": 0.7
}

If you cannot determine a field, use "unknown". Return only valid JSON, no markdown.`;

  try {
    const response = await callLLM('system', 'classify', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 400,
    });
    const text = response.content.trim().replace(/^```json\s*/, '').replace(/```$/, '');
    const parsed = JSON.parse(text) as Partial<CompanyResearch>;
    return {
      company_size_estimate: parsed.company_size_estimate || 'unknown',
      industry: parsed.industry || 'unknown',
      likely_gtm_motion: parsed.likely_gtm_motion || 'unknown',
      pricing_model: parsed.pricing_model || 'unknown',
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
      funding_stage: parsed.funding_stage || 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      evidence_urls,
    };
  } catch {
    return { ...STUB, confidence: 0.1, evidence_urls };
  }
}
