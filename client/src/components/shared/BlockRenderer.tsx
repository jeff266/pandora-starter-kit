import React from 'react';
import type { PandoraBlock } from '../../../../shared/types/response-blocks';
import ChartRenderer from './ChartRenderer';
import NarrativeBlockView from '../blocks/NarrativeBlockView';
import TableBlockView from '../blocks/TableBlockView';
import ActionCardBlockView from '../blocks/ActionCardBlockView';

interface BlockRendererProps {
  block: PandoraBlock;
  compact?: boolean;
}

export default function BlockRenderer({ block, compact }: BlockRendererProps) {
  switch (block.blockType) {
    case 'narrative':
      return <NarrativeBlockView block={block} />;
    case 'chart':
      return <ChartRenderer spec={block.spec} compact={compact} />;
    case 'table':
      return <TableBlockView block={block} />;
    case 'action_card':
      return <ActionCardBlockView block={block} />;
    default:
      console.warn(`Unknown block type: ${(block as any).blockType}`);
      return null;
  }
}
