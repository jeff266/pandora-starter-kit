import { NodeViewWrapper } from '@tiptap/react';
import ChartRenderer from '../../shared/ChartRenderer';
import { ChartSpec } from '../../../types/chart-types';

export default function ChartNodeView({ node, selected }: {
  node: { attrs: { spec: ChartSpec | null; chartId: string | null } };
  selected: boolean;
}) {
  const { spec } = node.attrs;

  if (!spec) return (
    <NodeViewWrapper>
      <div className="flex items-center justify-center h-32 border
                      border-dashed rounded text-muted-foreground text-sm">
        Chart data unavailable
      </div>
    </NodeViewWrapper>
  );

  return (
    <NodeViewWrapper>
      <div className={`relative rounded overflow-hidden
                       ${selected ? 'ring-2 ring-primary' : ''}`}>
        <ChartRenderer spec={spec} compact={false} />
      </div>
    </NodeViewWrapper>
  );
}
