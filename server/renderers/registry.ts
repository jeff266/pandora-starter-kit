/**
 * Renderer Registry
 *
 * Central registry for all renderers in the system.
 * Provides renderer selection and multi-format rendering capabilities.
 */

import { Renderer, RendererInput, RenderOutput } from './types.js';

const renderers: Map<string, Renderer> = new Map();

/**
 * Register a renderer for a specific format
 */
export function registerRenderer(renderer: Renderer): void {
  renderers.set(renderer.format, renderer);
  console.log(`[Renderers] Registered renderer: ${renderer.format}`);
}

/**
 * Get a renderer by format
 */
export function getRenderer(format: string): Renderer | undefined {
  return renderers.get(format);
}

/**
 * Render a deliverable in a specific format
 */
export async function renderDeliverable(
  format: string,
  input: RendererInput
): Promise<RenderOutput> {
  const renderer = renderers.get(format);
  if (!renderer) {
    const available = Array.from(renderers.keys()).join(', ');
    throw new Error(`No renderer registered for format: ${format}. Available: ${available || 'none'}`);
  }
  return renderer.render(input);
}

/**
 * Render a deliverable in multiple formats simultaneously
 */
export async function renderMultiple(
  formats: string[],
  input: RendererInput
): Promise<RenderOutput[]> {
  return Promise.all(formats.map(f => renderDeliverable(f, input)));
}

/**
 * Get all registered renderer formats
 */
export function getRegisteredFormats(): string[] {
  return Array.from(renderers.keys());
}
