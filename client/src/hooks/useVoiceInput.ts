import { useState, useRef, useCallback } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

/**
 * Hook that provides voice-to-text input via the Web Speech API.
 * Stops automatically after `silenceMs` of no new results (default 4 000 ms).
 */
export function useVoiceInput(silenceMs = 4000) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [supported] = useState(
    () => typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const start = useCallback((onResult: (text: string) => void) => {
    if (!supported) return;

    // If already listening, stop
    if (recognitionRef.current) {
      stop();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    const resetSilenceTimer = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop();
      }, silenceMs);
    };

    recognition.onstart = () => {
      setListening(true);
      setTranscript('');
      finalTranscript = '';
      resetSilenceTimer();
    };

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      resetSilenceTimer();
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      const combined = (finalTranscript + interim).trim();
      setTranscript(combined);
      onResult(combined);
    };

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== 'aborted') {
        console.warn('Speech recognition error:', e.error);
      }
      stop();
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [supported, silenceMs, stop]);

  return { listening, transcript, start, stop, supported };
}
