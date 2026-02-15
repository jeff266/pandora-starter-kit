/**
 * Renderers Module
 *
 * Barrel exports for all renderers and registration functionality.
 */

export type { Renderer, RendererInput, RenderOutput, BrandingConfig, VoiceConfig, RenderOptions } from './types.js';
export { registerRenderer, getRenderer, renderDeliverable, renderMultiple, getRegisteredFormats } from './registry.js';
export { WorkbookGenerator } from './workbook-generator.js';
export { PDFRenderer } from './pdf-renderer.js';
export { SlackRenderer } from './slack-renderer.js';
export { CommandCenterRenderer } from './command-center-renderer.js';
export { PPTXRenderer } from './pptx-renderer.js';

/**
 * Initialize and register all renderers
 * Call this at app startup
 */
export async function initRenderers(): Promise<void> {
  const { registerRenderer } = await import('./registry.js');
  const { WorkbookGenerator } = await import('./workbook-generator.js');
  const { PDFRenderer } = await import('./pdf-renderer.js');
  const { SlackRenderer } = await import('./slack-renderer.js');
  const { CommandCenterRenderer } = await import('./command-center-renderer.js');
  const { PPTXRenderer } = await import('./pptx-renderer.js');

  registerRenderer(new WorkbookGenerator());
  registerRenderer(new PDFRenderer());
  registerRenderer(new SlackRenderer());
  registerRenderer(new CommandCenterRenderer());
  registerRenderer(new PPTXRenderer());

  console.log('[Renderers] Registered 5 renderers: xlsx, pdf, slack_blocks, command_center, pptx (stub)');
}
