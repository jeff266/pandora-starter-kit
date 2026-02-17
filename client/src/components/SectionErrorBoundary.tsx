import React from 'react';
import { colors } from '../styles/theme';

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
}

export default class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SectionError]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 24,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <p style={{ color: colors.textMuted, marginBottom: 12, fontSize: 13 }}>
            {this.props.fallbackMessage || 'Something went wrong loading this section.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
