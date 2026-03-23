/**
 * Call Scorer
 *
 * Scores call transcripts against workspace-defined call scoring rubrics
 * with dimension weights, pass/fail signals, and qualifying questions.
 */

import { createLogger } from '../utils/logger.js';
import { ALL_FRAMEWORKS } from '../config/methodology-frameworks.js';

const logger = createLogger('CallScorer');

export interface CallScoringRubric {
  [dimension: string]: {
    weight: number;
    pass_signals: string[];
    fail_signals: string[];
    qualifying_question?: string;
  };
}

export interface DimensionScore {
  score: number;
  signal_matches: string[];
  notes: string;
}

export interface CallScoreResult {
  total_score: number;
  dimension_scores: {
    [dimension: string]: DimensionScore;
  };
  methodology: string;
  config_version: number;
  rubric_source: 'workspace' | 'system_default';
  scored_at: string;
}

export class CallScorer {
  /**
   * Score a call transcript against the workspace rubric
   */
  async score(
    transcript: string,
    rubric: CallScoringRubric,
    workspaceId: string,
    configVersion: number
  ): Promise<CallScoreResult> {
    const scoredAt = new Date().toISOString();

    // Check if rubric is empty (use system default)
    const isSystemDefault = !rubric || Object.keys(rubric).length === 0;

    if (isSystemDefault) {
      logger.debug('Using system default rubric', { workspaceId });
      rubric = this.buildSystemDefaultRubric('meddpicc');
    }

    // Build scoring prompt
    const prompt = this.buildScoringPrompt(transcript, rubric);

    try {
      // Call DeepSeek
      const result = await this.callDeepSeek(prompt);

      // Parse result
      const dimensionScores = this.parseScoreResult(result, rubric);

      // Calculate total score (weighted sum)
      const totalScore = this.calculateTotalScore(dimensionScores, rubric);

      const scoreResult: CallScoreResult = {
        total_score: totalScore,
        dimension_scores: dimensionScores,
        methodology: this.getMethodologyFromRubric(rubric),
        config_version: configVersion,
        rubric_source: isSystemDefault ? 'system_default' : 'workspace',
        scored_at: scoredAt,
      };

      logger.info('Call scoring completed', {
        workspaceId,
        totalScore,
        dimensionCount: Object.keys(dimensionScores).length,
        rubricSource: scoreResult.rubric_source,
      });

      return scoreResult;
    } catch (error: any) {
      logger.error('Call scoring failed', {
        error: error.message,
        workspaceId,
      });

      // Return zero score on failure
      return {
        total_score: 0,
        dimension_scores: {},
        methodology: 'unknown',
        config_version: configVersion,
        rubric_source: isSystemDefault ? 'system_default' : 'workspace',
        scored_at: scoredAt,
      };
    }
  }

  /**
   * Build scoring prompt for DeepSeek
   */
  private buildScoringPrompt(
    transcript: string,
    rubric: CallScoringRubric
  ): string {
    const dimensions = Object.entries(rubric)
      .map(([dim, config]) => {
        return `${dim} (weight: ${config.weight}):
  Question: ${config.qualifying_question || 'N/A'}
  Pass signals: ${config.pass_signals.join('; ')}
  Fail signals: ${config.fail_signals.join('; ')}`;
      })
      .join('\n\n');

    return `You are scoring a sales call transcript against a qualification rubric.

Dimensions to score:
${dimensions}

Transcript:
${transcript.slice(0, 8000)}

For each dimension, evaluate:
- Score: 0 (failed), partial (50% of weight), or full (100% of weight)
- Signal matches: Which specific pass/fail signals were observed
- Notes: Brief explanation (1-2 sentences)

Return ONLY valid JSON. No preamble. Schema:
{
  "dimension_name": {
    "score": number,
    "signal_matches": ["signal1", "signal2"],
    "notes": "brief explanation"
  }
}`;
  }

  /**
   * Call DeepSeek API
   */
  private async callDeepSeek(prompt: string): Promise<string> {
    const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
    if (!FIREWORKS_API_KEY) {
      throw new Error('FIREWORKS_API_KEY not configured');
    }

    const response = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIREWORKS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'accounts/fireworks/models/deepseek-v3',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Parse score result from LLM
   */
  private parseScoreResult(
    llmOutput: string,
    rubric: CallScoringRubric
  ): Record<string, DimensionScore> {
    try {
      const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('No JSON found in scoring output', { output: llmOutput.slice(0, 200) });
        return this.getZeroScores(rubric);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const result: Record<string, DimensionScore> = {};

      for (const dimension of Object.keys(rubric)) {
        const dimData = parsed[dimension];

        if (dimData && typeof dimData === 'object') {
          result[dimension] = {
            score: typeof dimData.score === 'number' ? dimData.score : 0,
            signal_matches: Array.isArray(dimData.signal_matches) ? dimData.signal_matches : [],
            notes: dimData.notes || 'No notes provided',
          };
        } else {
          // Dimension not scored
          result[dimension] = {
            score: 0,
            signal_matches: [],
            notes: 'Not evaluated',
          };
        }
      }

      return result;
    } catch (error: any) {
      logger.error('Failed to parse scoring result', {
        error: error.message,
        output: llmOutput.slice(0, 500),
      });
      return this.getZeroScores(rubric);
    }
  }

  /**
   * Calculate weighted total score
   */
  private calculateTotalScore(
    dimensionScores: Record<string, DimensionScore>,
    rubric: CallScoringRubric
  ): number {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const [dimension, config] of Object.entries(rubric)) {
      const dimScore = dimensionScores[dimension];
      if (dimScore) {
        totalWeight += config.weight;
        weightedScore += dimScore.score;
      }
    }

    return totalWeight > 0 ? Math.round(weightedScore) : 0;
  }

  /**
   * Get methodology name from rubric (heuristic)
   */
  private getMethodologyFromRubric(rubric: CallScoringRubric): string {
    const dimensions = Object.keys(rubric);

    // Check for MEDDIC dimensions
    if (dimensions.includes('metrics') && dimensions.includes('economic_buyer')) {
      return 'meddpicc';
    }

    // Check for GAP Selling
    if (dimensions.includes('gap') || dimensions.includes('impact')) {
      return 'gap_selling';
    }

    // Check for BANT
    if (dimensions.includes('budget') && dimensions.includes('authority')) {
      return 'bant';
    }

    return 'custom';
  }

  /**
   * Build system default rubric from framework
   */
  private buildSystemDefaultRubric(frameworkKey: string): CallScoringRubric {
    const framework = ALL_FRAMEWORKS.find(f => f.id === frameworkKey);
    if (!framework) {
      return {};
    }

    const rubric: CallScoringRubric = {};
    const dimensionCount = framework.dimensions.length;
    const equalWeight = dimensionCount > 0 ? Math.round(100 / dimensionCount) : 0;

    for (const dimension of framework.dimensions) {
      rubric[dimension.id] = {
        weight: equalWeight,
        pass_signals: dimension.positive_signals,
        fail_signals: dimension.negative_signals,
        qualifying_question: dimension.qualifying_questions[0], // Use first question
      };
    }

    return rubric;
  }

  /**
   * Get zero scores for all dimensions (fallback)
   */
  private getZeroScores(rubric: CallScoringRubric): Record<string, DimensionScore> {
    const result: Record<string, DimensionScore> = {};

    for (const dimension of Object.keys(rubric)) {
      result[dimension] = {
        score: 0,
        signal_matches: [],
        notes: 'Scoring failed',
      };
    }

    return result;
  }
}

// Singleton instance
let scorerInstance: CallScorer | null = null;

export function getCallScorer(): CallScorer {
  if (!scorerInstance) {
    scorerInstance = new CallScorer();
  }
  return scorerInstance;
}
