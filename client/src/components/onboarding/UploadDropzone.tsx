import { useRef, useState } from 'react';

const ACCEPTED_TYPES = 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,image/png,image/jpeg,image/webp,text/plain,text/markdown';
const ACCEPTED_EXTENSIONS = '.pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt,.md';

interface UploadDropzoneProps {
  onUpload: (file: File) => void;
  uploading?: boolean;
}

export function UploadDropzone({ onUpload, uploading }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function handleFile(file: File) {
    setSelected(file.name);
    onUpload(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div
      onClick={() => !uploading && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      title="PDF, DOCX, XLSX, CSV, PNG, JPG supported"
      style={{
        border: `1.5px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 6,
        padding: '7px 12px',
        cursor: uploading ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--color-text-muted)',
        background: dragOver ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 14 }}>{uploading ? '⏳' : '📎'}</span>
      {uploading ? 'Uploading…' : selected ? `${selected} — click to change` : 'Drop a file or click to upload (PDF, DOCX, XLSX, CSV, image)'}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES + ',' + ACCEPTED_EXTENSIONS}
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        disabled={uploading}
      />
    </div>
  );
}
