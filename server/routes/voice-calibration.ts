import express from 'express';
import type { VoiceProfile, VoiceRenderContext } from '../voice/types.js';
import { DEFAULT_VOICE_PROFILE } from '../voice/types.js';
import { buildVoiceSystemPromptSection, applyPostTransforms } from '../voice/voice-renderer.js';

const router = express.Router();

const SAMPLE_OUTPUTS: Record<string, string> = {
  late_quarter_behind: `It appears that we are currently at 65% of our quarterly target with only 12 days remaining. It seems that several key deals in the late-stage pipeline have stalled. Based on the available data, it's possible that we might miss the commit if these are not unstuck immediately. One could argue that the team needs to prioritize the Enterprise Healthcare deal to close the gap.`,
  on_track: `The data suggests that the team is performing well, with 82% attainment and 45 days left in the quarter. It's worth noting that the pipeline coverage remains healthy at 3.5x. It appears that most reps are pacing toward their individual quotas, and it seems that we are in a strong position to exceed the baseline forecast.`,
  over_target: `I am pleased to report that the team has exceeded 100% attainment, currently sitting at 112% with 20 days still on the clock. It's worth noting that this was driven by a massive surge in mid-market closures. It appears that we have successfully de-risked the quarter, and the data suggests that any further deals will contribute to an exceptional over-performance.`,
  mid_quarter_review: `Based on the available data, we are at the halfway point of the quarter with 48% attainment. It seems that lead velocity has slowed slightly compared to last month. It's possible that we need to increase top-of-funnel activity. One could argue that while we are currently on track, the data suggests we should keep a close eye on early-stage conversion rates.`
};

router.post('/api/workspaces/:workspaceId/voice/preview', async (req, res) => {
  try {
    const { voiceProfile, sampleContext } = req.body;
    
    if (!voiceProfile) {
      return res.status(400).json({ error: 'voiceProfile is required in request body' });
    }

    const profile: VoiceProfile = {
      ...DEFAULT_VOICE_PROFILE,
      ...voiceProfile
    };

    const context: VoiceRenderContext = {
      attainment_pct: sampleContext?.attainment_pct || 75,
      days_remaining: sampleContext?.days_remaining || 30,
      quarter_phase: sampleContext?.quarter_phase || 'mid_quarter',
      week_day: sampleContext?.week_day || new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date()),
      surface: 'chat'
    };

    const scenario = sampleContext?.sample_scenario || 'late_quarter_behind';
    const sampleOutputBefore = SAMPLE_OUTPUTS[scenario] || SAMPLE_OUTPUTS.late_quarter_behind;

    const systemPromptSection = buildVoiceSystemPromptSection(profile, context);
    const { text: sampleOutputAfter, transformationsApplied } = applyPostTransforms(sampleOutputBefore, profile);

    res.json({
      systemPromptSection,
      sampleOutputBefore,
      sampleOutputAfter,
      transformationsApplied
    });
  } catch (err) {
    console.error('[voice-calibration] Preview error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
