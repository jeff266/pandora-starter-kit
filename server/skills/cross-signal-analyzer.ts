export interface CrossSignalInput {
  workspaceId: string;
  sessionId: string;
  findings: any[];
}

export interface CrossSignalFinding {
  id: string;
  type: 'convergent' | 'contradictory' | 'amplifying';
  patternId: string;
  title: string;
  summary: string;
  rootCause: string;
  recommendation: string;
  severity: 'critical' | 'warning' | 'info';
  entities: Array<{
    type: 'deal' | 'account' | 'contact' | 'rep';
    id: string;
    name: string;
  }>;
  sourceFindingIds: string[];
  category: 'cross_signal';
}

const CROSS_SIGNAL_PATTERNS = [
  {
    id: 'pricing_friction_to_conversion_drop',
    name: 'Pricing Friction linked to Conversion Drop',
    description: 'Detects when pricing-related objections in calls correlate with a drop in stage conversion rates.',
    match: (findings: any[]) => {
      const callFindings = findings.filter(f => f.category === 'calls' && (f.summary?.toLowerCase().includes('price') || f.summary?.toLowerCase().includes('pricing') || f.summary?.toLowerCase().includes('cost')));
      const conversionFindings = findings.filter(f => f.category === 'pipeline' && (f.summary?.toLowerCase().includes('conversion') || f.summary?.toLowerCase().includes('drop') || f.summary?.toLowerCase().includes('fall')));
      
      if (callFindings.length > 0 && conversionFindings.length > 0) {
        return {
          matched: true,
          sources: [...callFindings, ...conversionFindings],
          severity: 'critical' as const
        };
      }
      return { matched: false };
    },
    generate: (matches: any[]): Partial<CrossSignalFinding> => ({
      title: 'Pricing Friction Correlation',
      summary: 'Detected multiple pricing objections in recent calls coinciding with a drop in pipeline conversion rates.',
      rootCause: 'Pricing structure or discounting authority may be misaligned with current market conditions.',
      recommendation: 'Review discounting floor for the current quarter or consider a limited-time bundle offer.'
    })
  },
  {
    id: 'single_thread_to_deal_risk',
    name: 'Single-Threading causing Deal Risk',
    description: 'Detects when a lack of multi-threading (single contact) matches with deals that have slipped or have low engagement.',
    match: (findings: any[]) => {
      const threadFindings = findings.filter(f => f.category === 'deals' && (f.summary?.toLowerCase().includes('single-thread') || f.summary?.toLowerCase().includes('one contact')));
      const riskFindings = findings.filter(f => (f.category === 'deals' || f.category === 'pipeline') && (f.summary?.toLowerCase().includes('risk') || f.summary?.toLowerCase().includes('slip') || f.summary?.toLowerCase().includes('stale')));
      
      if (threadFindings.length > 0 && riskFindings.length > 0) {
        // Find overlapping deals if possible
        const threadDeals = new Set(threadFindings.flatMap(f => f.entity_ids || []));
        const riskDeals = new Set(riskFindings.flatMap(f => f.entity_ids || []));
        const overlap = [...threadDeals].filter(id => riskDeals.has(id));

        if (overlap.length > 0 || (threadFindings.length > 0 && riskFindings.length > 0)) {
          return {
            matched: true,
            sources: [...threadFindings, ...riskFindings],
            severity: 'warning' as const
          };
        }
      }
      return { matched: false };
    },
    generate: (matches: any[]): Partial<CrossSignalFinding> => ({
      title: 'Single-Thread Risk Amplification',
      summary: 'Deals identified as single-threaded are showing increased signs of risk (stalling or slipping).',
      rootCause: 'Lack of multi-stakeholder engagement is making these deals vulnerable to single-point-of-failure.',
      recommendation: 'Mandate executive alignment calls for all single-threaded deals above $50K.'
    })
  },
  {
    id: 'icp_mismatch_to_churn_signal',
    name: 'ICP Mismatch driving Churn Risk',
    description: 'Detects when accounts outside of ICP show early warning signals of churn or low usage.',
    match: (findings: any[]) => {
      const icpFindings = findings.filter(f => f.category === 'accounts' && (f.summary?.toLowerCase().includes('icp') || f.summary?.toLowerCase().includes('mismatch')));
      const churnFindings = findings.filter(f => f.category === 'intelligence' && (f.summary?.toLowerCase().includes('churn') || f.summary?.toLowerCase().includes('risk')));
      
      if (icpFindings.length > 0 && churnFindings.length > 0) {
        return {
          matched: true,
          sources: [...icpFindings, ...churnFindings],
          severity: 'warning' as const
        };
      }
      return { matched: false };
    },
    generate: (matches: any[]): Partial<CrossSignalFinding> => ({
      title: 'ICP Alignment Warning',
      summary: 'Early churn signals are concentrated in accounts that do not match our Ideal Customer Profile.',
      rootCause: 'Sales and marketing are acquiring customers that our product is not yet optimized to retain.',
      recommendation: 'Tighten lead qualification criteria for non-ICP industries.'
    })
  },
  {
    id: 'data_quality_to_forecast_risk',
    name: 'Data Quality impacting Forecast Reliability',
    description: 'Detects when poor CRM data quality (missing fields, old close dates) correlates with high forecast variance.',
    match: (findings: any[]) => {
      const dataFindings = findings.filter(f => f.category === 'operations' && (f.summary?.toLowerCase().includes('data quality') || f.summary?.toLowerCase().includes('missing')));
      const forecastFindings = findings.filter(f => f.category === 'forecasting' && (f.summary?.toLowerCase().includes('variance') || f.summary?.toLowerCase().includes('accuracy')));
      
      if (dataFindings.length > 0 && forecastFindings.length > 0) {
        return {
          matched: true,
          sources: [...dataFindings, ...forecastFindings],
          severity: 'info' as const
        };
      }
      return { matched: false };
    },
    generate: (matches: any[]): Partial<CrossSignalFinding> => ({
      title: 'Forecast Integrity Risk',
      summary: 'High forecast variance detected alongside significant CRM data quality gaps.',
      rootCause: 'Incomplete deal data is leading to unreliable automated projections and manual overrides.',
      recommendation: 'Enforce "Next Step" and "Economic Buyer" field completion before deals can move to Stage 3.'
    })
  }
];

export function runCrossSignalAnalysis(input: CrossSignalInput): CrossSignalFinding[] {
  const findings: CrossSignalFinding[] = [];
  
  for (const pattern of CROSS_SIGNAL_PATTERNS) {
    const matchResult = pattern.match(input.findings);
    if (matchResult.matched) {
      const gen = pattern.generate(matchResult.sources || []);
      
      // Extract entities from source findings
      const entitiesMap = new Map<string, {type: any, id: string, name: string}>();
      matchResult.sources?.forEach((f: any) => {
        if (f.entity_type && f.entity_id) {
          entitiesMap.set(`${f.entity_type}:${f.entity_id}`, {
            type: f.entity_type,
            id: f.entity_id,
            name: f.entity_name || f.entity_id
          });
        }
        if (f.entity_ids && Array.isArray(f.entity_ids)) {
          f.entity_ids.forEach((id: string) => {
             // We might not have names for all IDs here, but we can store them
             entitiesMap.set(`unknown:${id}`, {
                type: (f.entity_type || 'deal') as any,
                id: id,
                name: id
             });
          });
        }
      });

      findings.push({
        id: `csf_${Math.random().toString(36).slice(2)}`,
        type: 'convergent', // Default per spec for these patterns
        patternId: pattern.id,
        title: gen.title || 'Cross-Signal Finding',
        summary: gen.summary || '',
        rootCause: gen.rootCause || '',
        recommendation: gen.recommendation || '',
        severity: matchResult.severity || 'info',
        entities: Array.from(entitiesMap.values()),
        sourceFindingIds: matchResult.sources?.map((s: any) => s.id || s.claim_id).filter(Boolean) || [],
        category: 'cross_signal'
      });
    }
  }
  
  return findings;
}
