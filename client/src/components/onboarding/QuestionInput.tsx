import { useState, useRef } from 'react';
import { UploadDropzone } from './UploadDropzone.js';

interface QuestionInputProps {
  placeholder?: string;
  onSubmit: (text: string) => void;
  onSkip: () => void;
  onUpload: (file: File) => void;
  submitting?: boolean;
  uploading?: boolean;
  skipMessage?: string;
}

export function QuestionInput({ placeholder, onSubmit, onSkip, onUpload, submitting, uploading, skipMessage }: QuestionInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    onSubmit(trimmed);
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 192) + 'px';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        border: '1.5px solid var(--color-border)',
        borderRadius: 10,
        background: 'var(--color-surface)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Tell me what looks right or what you'd change…"}
          disabled={submitting || uploading}
          rows={2}
          style={{
            width: '100%',
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: '12px 14px 8px 14px',
            fontSize: 14,
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ padding: '6px 10px 8px 10px', borderTop: '1px solid var(--color-border)' }}>
          <UploadDropzone onUpload={onUpload} uploading={uploading} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={() => onSkip()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-textMuted)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '2px 0',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
          }}
        >
          {skipMessage ?? 'Skip and use defaults →'}
        </button>

        <button
          onClick={submit}
          disabled={!value.trim() || submitting}
          style={{
            background: value.trim() && !submitting ? 'var(--color-accent)' : 'var(--color-border)',
            color: value.trim() && !submitting ? '#fff' : 'var(--color-textMuted)',
            border: 'none',
            borderRadius: 7,
            padding: '7px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: value.trim() && !submitting ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
          }}
        >
          {submitting ? '…' : 'Send →'}
        </button>
      </div>
    </div>
  );
}
