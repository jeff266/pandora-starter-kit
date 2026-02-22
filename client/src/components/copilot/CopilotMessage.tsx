import React from 'react';
import { colors, fonts } from '../../styles/theme';
import type { ChatMessage } from './copilot-steps';

interface Props {
  message: ChatMessage;
}

export default function CopilotMessage({ message }: Props) {
  const isBot = message.role === 'assistant';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isBot ? 'flex-start' : 'flex-end',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '10px 14px',
        borderRadius: isBot ? '2px 12px 12px 12px' : '12px 12px 2px 12px',
        background: isBot ? colors.surface : colors.accentSoft,
        border: `1px solid ${isBot ? colors.border : 'rgba(59,130,246,0.25)'}`,
        font: `400 14px/1.5 ${fonts.sans}`,
        color: isBot ? colors.text : colors.accent,
        whiteSpace: 'pre-wrap',
      }}>
        {message.content}
      </div>
    </div>
  );
}
