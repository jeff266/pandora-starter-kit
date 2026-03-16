import { useEffect, useState, useRef, useCallback } from 'react';

interface StreamingGreetingProps {
  workspaceId: string;
  onComplete?: () => void;
}

export function StreamingGreeting({ workspaceId, onComplete }: StreamingGreetingProps) {
  const [displayText, setDisplayText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [greeting, setGreeting] = useState<string | null>(null);
  const indexRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/workspaces/${workspaceId}/briefing/concierge-greeting`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (typeof data.greeting === 'string' && data.greeting.length > 0) {
          setGreeting(data.greeting);
        } else {
          onCompleteRef.current?.();
        }
      })
      .catch(() => {
        onCompleteRef.current?.();
      });
  }, [workspaceId]);

  const startTyping = useCallback((text: string) => {
    indexRef.current = 0;
    setDisplayText('');
    setIsComplete(false);

    function getDelay(char: string): number {
      if (char === '.') return 260;
      if (char === ',') return 100;
      if (char === ' ') return 22;
      return 20 + Math.random() * 16;
    }

    function typeNext() {
      if (indexRef.current >= text.length) {
        setIsComplete(true);
        onCompleteRef.current?.();
        return;
      }
      const char = text[indexRef.current];
      setDisplayText(prev => prev + char);
      indexRef.current++;
      setTimeout(typeNext, getDelay(char));
    }

    const t = setTimeout(typeNext, 280);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!greeting) return;
    return startTyping(greeting);
  }, [greeting, startTyping]);

  if (!greeting) return null;

  return (
    <div style={{
      fontSize: '17px',
      fontWeight: 400,
      lineHeight: 1.55,
      color: '#e8ecf4',
      letterSpacing: '-0.01em',
      minHeight: '1.6rem',
      fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
    }}>
      {displayText}
      {!isComplete && (
        <span style={{
          display: 'inline-block',
          width: '1.5px',
          height: '1em',
          background: '#5a6578',
          marginLeft: '1px',
          verticalAlign: 'text-bottom',
          animation: 'sg-blink 0.85s step-end infinite',
        }} />
      )}
      <style>{`@keyframes sg-blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

export default StreamingGreeting;
