import React from 'react';
import type { PandoraResponse } from '../../../../shared/types/response-blocks';
import BlockRenderer from './BlockRenderer';

interface ResponseEnvelopeRendererProps {
  response: PandoraResponse;
  compact?: boolean;
}

export default function ResponseEnvelopeRenderer({ response, compact }: ResponseEnvelopeRendererProps) {
  if (!response.blocks.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {response.blocks.map(block => (
        <BlockRenderer key={block.id} block={block} compact={compact} />
      ))}
    </div>
  );
}
