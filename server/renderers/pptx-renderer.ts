/**
 * PPTX Renderer (Stub)
 *
 * Placeholder for future PowerPoint slide deck generation.
 * Returns helpful error message indicating feature is planned but not yet available.
 */

import { Renderer, RendererInput, RenderOutput } from './types.js';

export class PPTXRenderer implements Renderer {
  format = 'pptx';

  async render(input: RendererInput): Promise<RenderOutput> {
    throw new Error(
      'PPTX rendering is not yet available. Use XLSX or PDF format. '
      + 'PPTX support is planned for the QBR deck feature.'
    );
  }
}
