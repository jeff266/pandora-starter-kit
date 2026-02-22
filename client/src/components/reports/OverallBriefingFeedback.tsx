import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

interface OverallBriefingFeedbackProps {
  workspaceId: string;
  agentId: string;
  generationId: string;
  existingRating?: number | null;
  existingSignal?: string | null;
}

const editorialSignals = [
  { value: 'good_structure', label: 'Good structure' },
  { value: 'wrong_lead', label: 'Wrong lead section' },
  { value: 'wrong_order', label: 'Wrong section order' },
  { value: 'wrong_tone', label: 'Wrong tone' },
];

export default function OverallBriefingFeedback({
  workspaceId,
  agentId,
  generationId,
  existingRating,
  existingSignal,
}: OverallBriefingFeedbackProps) {
  const [rating, setRating] = useState<number | null>(existingRating || null);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(existingSignal || null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const needsComment = selectedSignal && ['wrong_lead', 'wrong_order', 'wrong_tone'].includes(selectedSignal);

  const commentPlaceholders: Record<string, string> = {
    wrong_lead: 'What should the briefing have led with?',
    wrong_order: 'What order would you prefer?',
    wrong_tone: 'How should the tone be adjusted?',
  };

  async function handleSubmit() {
    try {
      setSubmitting(true);

      // Submit overall rating if set
      if (rating) {
        await api.post(`/agents/${agentId}/feedback`, {
          generation_id: generationId,
          feedback_type: 'overall',
          signal: rating >= 4 ? 'useful' : 'not_useful',
          rating,
        });
      }

      // Submit editorial signal if set
      if (selectedSignal) {
        await api.post(`/agents/${agentId}/feedback`, {
          generation_id: generationId,
          feedback_type: 'editorial',
          signal: selectedSignal,
          comment: comment || undefined,
        });
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      alert('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div style={{
        marginTop: 32,
        padding: 16,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
      }}>
        <p style={{ fontSize: 14, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>
          ✓ Thank you for your feedback!
        </p>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 32,
      padding: 16,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
    }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, margin: '0 0 16px 0' }}>
        How was this briefing?
      </h3>

      {/* Star rating */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              disabled={submitting}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                padding: 4,
              }}
            >
              <Star
                style={{
                  width: 24,
                  height: 24,
                  fill: star <= (rating || 0) ? '#fbbf24' : 'transparent',
                  stroke: star <= (rating || 0) ? '#fbbf24' : colors.border,
                  transition: 'all 0.2s',
                }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Editorial signals */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: colors.text, fontFamily: fonts.sans, marginBottom: 8 }}>
          Structure & presentation:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {editorialSignals.map(({ value, label }) => {
            const isSelected = selectedSignal === value;
            return (
              <button
                key={value}
                onClick={() => setSelectedSignal(isSelected ? null : value)}
                disabled={submitting}
                style={{
                  padding: '6px 12px',
                  background: isSelected ? colors.accent : 'transparent',
                  color: isSelected ? '#fff' : colors.text,
                  border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                  borderRadius: 6,
                  fontSize: 14,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: fonts.sans,
                }}
                onMouseEnter={(e) => {
                  if (!submitting && !isSelected) {
                    e.currentTarget.style.background = colors.surfaceRaised;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conditional comment for editorial feedback */}
      {needsComment && (
        <div style={{ marginBottom: 16 }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={commentPlaceholders[selectedSignal || ''] || 'Optional comment...'}
            rows={2}
            style={{
              width: '100%',
              padding: 8,
              fontSize: 14,
              fontFamily: fonts.sans,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={(needsComment && !comment) || submitting || (!rating && !selectedSignal)}
        style={{
          padding: '8px 16px',
          background: (!rating && !selectedSignal) || submitting ? colors.border : colors.accent,
          color: (!rating && !selectedSignal) || submitting ? colors.textMuted : '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          cursor: (!rating && !selectedSignal) || submitting ? 'not-allowed' : 'pointer',
          fontFamily: fonts.sans,
        }}
      >
        {submitting ? 'Submitting...' : 'Submit Overall Feedback'}
      </button>
    </div>
  );
}
