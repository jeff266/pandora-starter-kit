interface ConfigArtifact {
  type: 'named_filter' | 'stage_update' | 'goal_set' | 'rep_classified' | 'config_saved';
  label: string;
  detail: string;
  items?: string[];
}

interface ArtifactPreviewProps {
  artifact: ConfigArtifact;
}

const ICONS: Record<ConfigArtifact['type'], string> = {
  named_filter: '⚡',
  stage_update: '📋',
  goal_set: '🎯',
  rep_classified: '👥',
  config_saved: '✓',
};

export function ArtifactPreview({ artifact }: ArtifactPreviewProps) {
  return (
    <div style={{
      background: 'color-mix(in srgb, var(--color-green) 8%, var(--color-surface))',
      border: '1px solid color-mix(in srgb, var(--color-green) 25%, var(--color-border))',
      borderRadius: 8,
      padding: '10px 14px',
      marginBottom: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{ICONS[artifact.type]}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>{artifact.label}</span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--color-textMuted)', paddingLeft: 22 }}>{artifact.detail}</span>
      {artifact.items && artifact.items.length > 0 && (
        <ul style={{ margin: '4px 0 0 22px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {artifact.items.map((item, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--color-textMuted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--color-green)', fontWeight: 700, fontSize: 10 }}>→</span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
