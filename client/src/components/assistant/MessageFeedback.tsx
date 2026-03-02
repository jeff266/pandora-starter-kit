import React, { useState, useCallback } from 'react';
import { colors } from '../../styles/theme';
import { getWorkspaceId, getAuthToken } from '../../lib/api';

interface MessageFeedbackProps {
  responseId: string;
}

type FeedbackState = 'none' | 'up' | 'down' | 'submitted';

export default function MessageFeedback({ responseId }: MessageFeedbackProps) {
  const [state, setState] = useState<FeedbackState>('none');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showThanks, setShowThanks] = useState(false);

  const submit = useCallback(async (signal: 'thumbs_up' | 'thumbs_down', text?: string) => {
    const workspaceId = getWorkspaceId();
    const token = getAuthToken();
    if (!workspaceId) return;

    setSubmitting(true);
    try {
      await fetch(`/api/workspaces/${workspaceId}/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ response_id: responseId, signal, comment: text || undefined }),
      });
      setShowThanks(true);
      setState('submitted');
      setTimeout(() => setShowThanks(false), 2500);
    } catch {
    } finally {
      setSubmitting(false);
    }
  }, [responseId]);

  const handleThumbsUp = useCallback(() => {
    if (state !== 'none') return;
    setState('up');
    submit('thumbs_up');
  }, [state, submit]);

  const handleThumbsDown = useCallback(() => {
    if (state !== 'none') return;
    setState('down');
  }, [state]);

  const handleSubmitComment = useCallback(() => {
    submit('thumbs_down', comment);
  }, [submit, comment]);

  if (showThanks) {
    return (
      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, paddingLeft: 2, opacity: 0.8 }}>
        Thanks for the feedback
      </div>
    );
  }

  if (state === 'submitted') return null;

  return (
    <div style={{ marginTop: 6, paddingLeft: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={handleThumbsUp}
          title="Good answer"
          disabled={submitting}
          style={{
            background: state === 'up' ? colors.accent + '20' : 'transparent',
            border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: 4,
            fontSize: 13, lineHeight: 1, color: state === 'up' ? colors.accent : colors.textMuted,
            opacity: submitting ? 0.5 : 1,
          }}
          onMouseEnter={e => { if (state === 'none') (e.currentTarget as HTMLButtonElement).style.color = colors.accent; }}
          onMouseLeave={e => { if (state === 'none') (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted; }}
        >
          ↑
        </button>
        <button
          onClick={handleThumbsDown}
          title="Poor answer"
          disabled={submitting}
          style={{
            background: state === 'down' ? '#ff6b6b20' : 'transparent',
            border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: 4,
            fontSize: 13, lineHeight: 1, color: state === 'down' ? '#ff6b6b' : colors.textMuted,
            opacity: submitting ? 0.5 : 1,
          }}
          onMouseEnter={e => { if (state === 'none') (e.currentTarget as HTMLButtonElement).style.color = '#ff6b6b'; }}
          onMouseLeave={e => { if (state === 'none') (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted; }}
        >
          ↓
        </button>
      </div>

      {state === 'down' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <input
            type="text"
            placeholder="What was wrong? (optional)"
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitComment(); }}
            autoFocus
            style={{
              flex: 1, fontSize: 11, padding: '4px 8px',
              background: colors.surface, border: `1px solid ${colors.border}`,
              borderRadius: 5, color: colors.text, outline: 'none',
              maxWidth: 260,
            }}
          />
          <button
            onClick={handleSubmitComment}
            disabled={submitting}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
              background: colors.accent + '20', border: `1px solid ${colors.accent + '40'}`,
              color: colors.accent, opacity: submitting ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
