# Report Annotation Layer Integration Guide

## Prerequisites

This integration assumes **Task 1 (Replit Migration)** has been completed:
- ReportViewer reads from `report_documents` table
- API endpoints use `/api/workspaces/:workspaceId/reports/*`
- Data structure uses `ReportDocument` with `sections[]` array

If the migration is not complete, complete that first before proceeding.

---

## Integration Steps for ReportViewer.tsx

### 1. Add Imports

```typescript
import AnnotatableSection from './report/AnnotatableSection';
import type { Annotation, ReportDocument } from '../types/annotations';
```

### 2. Add State Management

Add after existing state declarations:

```typescript
const [annotations, setAnnotations] = useState<Annotation[]>([]);
const [isAnnotating, setIsAnnotating] = useState(false);
```

### 3. Load Annotations on Report Load

Add this useEffect after the report loading logic:

```typescript
useEffect(() => {
  if (!reportDocument?.id || !workspaceId) return;

  const token = localStorage.getItem('pandora_session');

  fetch(
    `/api/workspaces/${workspaceId}/reports/` +
    `${reportDocument.id}/annotations`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
    .then(r => r.json())
    .then(data => setAnnotations(Array.isArray(data) ? data : []))
    .catch(err => console.error('Failed to load annotations:', err));
}, [reportDocument?.id, workspaceId]);
```

### 4. Replace Section Rendering

Find the section rendering code (likely in the `<div className="report-body">` section) and replace it with:

```typescript
<div className="report-body">
  {reportDocument.sections.map(section => (
    <AnnotatableSection
      key={section.id}
      section={section}
      annotations={annotations.filter(
        a => a.section_id === section.id
      )}
      isAnnotating={isAnnotating}
      onAnnotationSave={async (data) => {
        const token = localStorage.getItem('pandora_session');
        const res = await fetch(
          `/api/workspaces/${workspaceId}/reports/` +
          `${reportDocument.id}/annotations`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(data),
          }
        );
        const saved: Annotation = await res.json();
        setAnnotations(prev => [
          ...prev.filter(a =>
            !(a.section_id === data.section_id &&
              a.paragraph_index === data.paragraph_index)
          ),
          saved,
        ]);
      }}
      onAnnotationDelete={async (annotationId) => {
        const token = localStorage.getItem('pandora_session');
        await fetch(
          `/api/workspaces/${workspaceId}/reports/` +
          `${reportDocument.id}/annotations/${annotationId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        setAnnotations(prev =>
          prev.filter(a => a.id !== annotationId)
        );
      }}
    />
  ))}

  {/* Recommended next steps — always at bottom */}
  {reportDocument.recommended_next_steps && (
    <div style={{
      marginTop: '32px',
      paddingTop: '16px',
      borderTop: '1px solid #E2E8F0',
      fontStyle: 'italic',
      color: '#475569',
      fontSize: '14px',
    }}>
      {reportDocument.recommended_next_steps}
    </div>
  )}
</div>
```

### 5. Add Annotation Count Badge

Add near the report title/header area:

```typescript
{annotations.length > 0 && !isAnnotating && (
  <button
    onClick={() => setIsAnnotating(true)}
    style={{
      fontSize: '12px',
      color: '#94A3B8',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '2px 6px',
    }}
  >
    📝 {annotations.length}
    {annotations.length === 1
      ? ' annotation' : ' annotations'}
  </button>
)}
```

### 6. Wire Annotate Button

Update the "Annotate" button onClick:

```typescript
<button
  onClick={() => setIsAnnotating(true)}
  // ... existing styles
>
  <Edit3 style={{ width: 15, height: 15 }} />
  Annotate
</button>
```

### 7. Add Exit Annotation Mode Button

When in annotation mode, show an exit button:

```typescript
{isAnnotating && (
  <button
    onClick={() => setIsAnnotating(false)}
    style={{
      background: 'rgba(255,255,255,0.15)',
      border: 'none',
      color: '#fff',
      borderRadius: 6,
      padding: '4px 12px',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600
    }}
  >
    Exit Annotation Mode
  </button>
)}
```

---

## Verification Checklist

After integration, verify:

- [ ] Clicking "Annotate" button sets `isAnnotating` to true
- [ ] Paragraphs show 💬 icon on hover when in annotation mode
- [ ] Clicking paragraph opens FloatingBubble
- [ ] Saving annotation persists to database and updates UI
- [ ] Annotations display correctly in both annotation and read modes
- [ ] Tab key navigates between paragraphs
- [ ] Cmd+Enter saves, Escape closes bubble
- [ ] Annotation count badge shows when annotations exist
- [ ] Exiting annotation mode hides all UI affordances
- [ ] All existing functionality (PDF/DOCX/Share/Anonymize) still works

---

## Troubleshooting

**Paragraphs not clickable:**
- Verify `isAnnotating` state is properly passed to AnnotatableSection
- Check console for JavaScript errors

**Annotations not persisting:**
- Verify API endpoints return 200 status
- Check network tab for request/response
- Verify workspace ownership checks pass

**FloatingBubble positioning issues:**
- Check that anchorRef is properly set
- Verify paragraph refs array is populated
- Test on different screen sizes

**Tab navigation not working:**
- Verify `tabIndex` is set on paragraphs when `isAnnotating={true}`
- Check that keyboard event handlers are attached

---

## API Reference

All annotation endpoints require authentication via Bearer token.

### GET /api/workspaces/:workspaceId/reports/:reportId/annotations
Returns array of annotations for the report.

### POST /api/workspaces/:workspaceId/reports/:reportId/annotations
Creates or updates annotation (upsert by section_id + paragraph_index).

Body:
```json
{
  "section_id": "string",
  "paragraph_index": 0,
  "annotation_type": "note|override|flag",
  "content": "string",
  "original_content": "string (optional, for overrides)"
}
```

### PATCH /api/workspaces/:workspaceId/reports/:reportId/annotations/:annotationId
Updates existing annotation.

### DELETE /api/workspaces/:workspaceId/reports/:reportId/annotations/:annotationId
Deletes annotation.

---

## Component API

### AnnotatableSection Props

```typescript
interface AnnotatableSectionProps {
  section: ReportSection;
  annotations: Annotation[];
  isAnnotating: boolean;
  onAnnotationSave: (data: Pick<Annotation, ...>) => Promise<void>;
  onAnnotationDelete: (annotationId: string) => Promise<void>;
}
```

### FloatingBubble Props

```typescript
interface FloatingBubbleProps {
  paragraphText: string;
  sectionId: string;
  paragraphIndex: number;
  existingAnnotation?: Annotation;
  anchorRef: React.RefObject<HTMLElement>;
  onSave: (type, content) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}
```
