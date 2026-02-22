import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface SectionFeedbackProps {
  workspaceId: string;
  agentId: string;
  generationId: string;
  sectionId: string;
  existingSignal?: string | null;
}

const signalLabels: Record<string, string> = {
  useful: 'Helpful',
  not_useful: 'Not helpful',
  good_insight: 'Great insight — keep doing this',
  wrong_emphasis: 'Wrong emphasis — focus on something else',
  too_detailed: 'Too detailed — just the headline please',
  too_brief: 'Too brief — need more context',
  wrong_data: 'Wrong data — a number or fact is incorrect',
  missing_context: 'Missing info I expected',
};

export default function SectionFeedback({
  workspaceId,
  agentId,
  generationId,
  sectionId,
  existingSignal,
}: SectionFeedbackProps) {
  const [expanded, setExpanded] = useState(false);
  const [submittedSignal, setSubmittedSignal] = useState<string | null>(existingSignal || null);
  const [selectedSignal, setSelectedSignal] = useState<string>('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitFeedback(signal: string, commentText?: string) {
    try {
      setSubmitting(true);
      await api.post(`/agents/${agentId}/feedback`, {
        generation_id: generationId,
        feedback_type: 'section',
        section_id: sectionId,
        signal,
        comment: commentText || undefined,
      });
      setSubmittedSignal(signal);
      setExpanded(false);
      setComment('');
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      alert('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  // Already submitted state
  if (submittedSignal && !expanded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 12,
        paddingTop: 12,
        borderTop: `1px solid ${colors.border}`,
        fontSize: 14,
        color: colors.textMuted,
        fontFamily: fonts.sans,
      }}>
        <span>Feedback submitted: {signalLabels[submittedSignal] || submittedSignal}</span>
        <button
          onClick={() => setExpanded(true)}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            border: 'none',
            color: colors.accent,
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: fonts.sans,
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 12,
      paddingTop: 12,
      borderTop: `1px solid ${colors.border}`
    }}>
      {/* Quick reactions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.sans }}>
          Was this helpful?
        </span>
        <button
          onClick={() => submitFeedback('useful')}
          disabled={submitting}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            fontSize: 14,
            color: colors.text,
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: fonts.sans,
          }}
          onMouseEnter={(e) => !submitting && (e.currentTarget.style.background = colors.surfaceRaised)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <ThumbsUp style={{ width: 14, height: 14 }} />
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          disabled={submitting}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            fontSize: 14,
            color: colors.text,
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: fonts.sans,
          }}
          onMouseEnter={(e) => !submitting && (e.currentTarget.style.background = colors.surfaceRaised)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <ThumbsDown style={{ width: 14, height: 14 }} />
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          disabled={submitting}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            fontSize: 14,
            color: colors.text,
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: fonts.sans,
          }}
          onMouseEnter={(e) => !submitting && (e.currentTarget.style.background = colors.surfaceRaised)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <MessageCircle style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{
          marginTop: 12,
          padding: 12,
          background: colors.surfaceRaised,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
            What could be better?
          </p>

          {/* Radio options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { value: 'wrong_emphasis', label: 'Wrong emphasis — should focus on something else' },
              { value: 'too_detailed', label: 'Too detailed — just the headline please' },
              { value: 'too_brief', label: 'Too brief — need more context' },
              { value: 'wrong_data', label: 'Wrong data — a number or fact is incorrect' },
              { value: 'missing_context', label: 'Missing info I expected' },
              { value: 'good_insight', label: 'Great insight — keep doing this' },
            ].map(({ value, label }) => (
              <label
                key={value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  color: colors.text,
                  cursor: 'pointer',
                  fontFamily: fonts.sans,
                }}
              >
                <input
                  type="radio"
                  name={`feedback-${sectionId}`}
                  value={value}
                  checked={selectedSignal === value}
                  onChange={(e) => setSelectedSignal(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {/* Comment field */}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional: tell the agent what you'd prefer..."
            rows={2}
            style={{
              padding: 8,
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              resize: 'vertical',
            }}
          />

          {/* Submit button */}
          <button
            onClick={() => submitFeedback(selectedSignal, comment)}
            disabled={!selectedSignal || submitting}
            style={{
              padding: '8px 16px',
              background: selectedSignal && !submitting ? colors.accent : colors.border,
              color: selectedSignal && !submitting ? '#fff' : colors.textMuted,
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: selectedSignal && !submitting ? 'pointer' : 'not-allowed',
              fontFamily: fonts.sans,
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </div>
      )}
    </div>
  );
}
