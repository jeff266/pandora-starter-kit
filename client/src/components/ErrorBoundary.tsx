import React, { Component, ErrorInfo, ReactNode } from 'react';
import { colors } from '../styles/theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: colors.bg,
          flexDirection: 'column',
          gap: 16,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: colors.textMuted, maxWidth: 400, textAlign: 'center' }}>
            {this.state.error || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: '' });
              window.location.href = '/';
            }}
            style={{
              padding: '8px 20px',
              background: colors.accent,
              color: '#fff',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
            }}
          >
            Return to Command Center
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
