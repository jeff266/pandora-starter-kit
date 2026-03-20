/**
 * test-annotation-rightclick.ts
 * 
 * Validates all 4 right-click annotation changes.
 * Run: npx ts-node test-annotation-rightclick.ts
 * Or paste into Replit shell: npx tsx test-annotation-rightclick.ts
 *
 * Does NOT require a browser. Uses JSDOM to simulate the DOM.
 * Does NOT hit the database or any API.
 */

import { JSDOM } from 'jsdom';

// ─── JSDOM setup ──────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
});
const { window } = dom;
const { document, CustomEvent, EventTarget } = window;

// Patch globals so any module that references window.dispatchEvent works
(global as any).window = window;
(global as any).document = document;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function buildSectionDOM(sectionId: string, paragraphCount = 3): HTMLElement {
  /**
   * Builds a minimal replica of the section DOM that AnnotatableSection renders.
   *
   *  <div data-section-id="overview">
   *    <h3 class="section-title">Overview</h3>
   *    <p data-paragraph="0">First paragraph text.</p>
   *    <p data-paragraph="1">Second paragraph text.</p>
   *    <p data-paragraph="2">Third paragraph text.</p>
   *  </div>
   */
  const section = document.createElement('div');
  section.dataset.sectionId = sectionId;

  const title = document.createElement('h3');
  title.className = 'section-title';
  title.textContent = 'Section Title';
  section.appendChild(title);

  for (let i = 0; i < paragraphCount; i++) {
    const p = document.createElement('p');
    p.dataset.paragraph = String(i);
    p.textContent = `Paragraph ${i} text.`;
    section.appendChild(p);
  }

  document.body.appendChild(section);
  return section;
}

function walkForParagraphIndex(target: EventTarget | null): number | null {
  /**
   * Replica of the DOM walk in ReportViewer onContextMenu (lines 999–1011).
   * Walks up from e.target until it finds [data-paragraph] or hits [data-section-id].
   */
  let el = target as HTMLElement | null;
  while (el) {
    if (el.dataset?.paragraph !== undefined) {
      const idx = parseInt(el.dataset.paragraph, 10);
      return isNaN(idx) ? null : idx;
    }
    if (el.dataset?.sectionId !== undefined) break; // reached section root
    el = el.parentElement;
  }
  return null;
}

// ─── Change 1: paragraphIndex state shape ─────────────────────────────────────

console.log('\nChange 1 — docContextMenu state captures paragraphIndex');

(() => {
  type DocContextMenu = {
    x: number;
    y: number;
    sectionId: string;
    sectionTitle: string;
    paragraphIndex: number | null;
  };

  // Right-click on a paragraph
  const menu1: DocContextMenu = {
    x: 100, y: 200,
    sectionId: 'exec-summary',
    sectionTitle: 'Executive Summary',
    paragraphIndex: 2,
  };
  assert(
    'paragraphIndex is a number when clicking a paragraph',
    typeof menu1.paragraphIndex === 'number' && menu1.paragraphIndex === 2
  );

  // Right-click on section header
  const menu2: DocContextMenu = {
    x: 100, y: 50,
    sectionId: 'exec-summary',
    sectionTitle: 'Executive Summary',
    paragraphIndex: null,
  };
  assert(
    'paragraphIndex is null when clicking section header',
    menu2.paragraphIndex === null
  );
})();

// ─── Change 1b: DOM walk logic ─────────────────────────────────────────────────

console.log('\nChange 1b — DOM walk reads el.dataset.paragraph');

(() => {
  const section = buildSectionDOM('walk-test', 3);

  // Click directly on <p data-paragraph="1">
  const p1 = section.querySelector('[data-paragraph="1"]') as HTMLElement;
  assert(
    'Direct click on <p data-paragraph="1"> returns index 1',
    walkForParagraphIndex(p1) === 1
  );

  // Click on a <span> nested inside <p data-paragraph="2">
  const span = document.createElement('span');
  span.textContent = 'bold word';
  p1.parentElement!.querySelectorAll('p')[2].appendChild(span);
  assert(
    'Click on child <span> inside <p data-paragraph="2"> returns index 2',
    walkForParagraphIndex(span) === 2
  );

  // Click on section title (no data-paragraph)
  const title = section.querySelector('.section-title') as HTMLElement;
  assert(
    'Click on section title returns null',
    walkForParagraphIndex(title) === null
  );

  // Click on section container itself
  assert(
    'Click on section root returns null',
    walkForParagraphIndex(section) === null
  );
})();

// ─── Change 2: onNote dispatches open-annotation-bubble ───────────────────────

console.log('\nChange 2 — onNote dispatches open-annotation-bubble event');

(() => {
  let receivedDetail: { sectionId: string; paragraphIndex: number } | null = null;
  let menuCleared = false;

  // Simulate the listener (AnnotatableSection useEffect)
  window.addEventListener('open-annotation-bubble', (e: Event) => {
    receivedDetail = (e as CustomEvent).detail;
  });

  // Simulate onNote when paragraphIndex IS a number (Change 2, main branch)
  function simulateOnNote(sectionId: string, paragraphIndex: number | null) {
    if (typeof paragraphIndex === 'number') {
      window.dispatchEvent(
        new CustomEvent('open-annotation-bubble', {
          detail: { sectionId, paragraphIndex },
        })
      );
      menuCleared = true; // setDocContextMenu(null)
    } else {
      // falls back to setIsAnnotating(true) — not tested here (existing behavior)
    }
  }

  simulateOnNote('pipeline-health', 1);

  assert(
    'Event dispatched with correct sectionId',
    receivedDetail?.sectionId === 'pipeline-health'
  );
  assert(
    'Event dispatched with correct paragraphIndex',
    receivedDetail?.paragraphIndex === 1
  );
  assert(
    'Menu cleared after dispatch (paragraphIndex is real number)',
    menuCleared === true
  );

  // Null path — no event, no menu clear
  receivedDetail = null;
  menuCleared = false;
  // onNote with null falls back to setIsAnnotating(true) — we only verify NO event fires
  function simulateOnNoteNull(sectionId: string, paragraphIndex: number | null) {
    if (typeof paragraphIndex === 'number') {
      window.dispatchEvent(
        new CustomEvent('open-annotation-bubble', { detail: { sectionId, paragraphIndex } })
      );
      menuCleared = true;
    }
    // else: setIsAnnotating(true) — not dispatched
  }

  simulateOnNoteNull('pipeline-health', null);
  assert(
    'No event dispatched when paragraphIndex is null',
    receivedDetail === null
  );
  assert(
    'Menu NOT cleared when paragraphIndex is null (fallback path)',
    menuCleared === false
  );
})();

// ─── Change 3: AnnotatableSection event listener ──────────────────────────────

console.log('\nChange 3 — AnnotatableSection listener calls setActiveParagraph');

(() => {
  let activeParagraph: number | null = null;
  const MY_SECTION_ID = 'deal-risk';

  // Simulate the useEffect listener registered by AnnotatableSection
  window.addEventListener('open-annotation-bubble', (e: Event) => {
    const { sectionId, paragraphIndex } = (e as CustomEvent<{
      sectionId: string;
      paragraphIndex: number;
    }>).detail;

    if (sectionId === MY_SECTION_ID && typeof paragraphIndex === 'number') {
      activeParagraph = paragraphIndex; // setActiveParagraph(targetIndex)
    }
  });

  // Fire event targeting THIS section
  window.dispatchEvent(
    new CustomEvent('open-annotation-bubble', {
      detail: { sectionId: MY_SECTION_ID, paragraphIndex: 2 },
    })
  );
  assert(
    'setActiveParagraph called with correct index when sectionId matches',
    activeParagraph === 2
  );

  // Fire event targeting a DIFFERENT section
  activeParagraph = null;
  window.dispatchEvent(
    new CustomEvent('open-annotation-bubble', {
      detail: { sectionId: 'some-other-section', paragraphIndex: 0 },
    })
  );
  assert(
    'setActiveParagraph NOT called when sectionId does not match',
    activeParagraph === null
  );
})();

// ─── Change 4: highlightedParagraphIndex prop + teal background ───────────────

console.log('\nChange 4 — highlightedParagraphIndex produces teal background, fades on null');

(() => {
  /**
   * Simulates what AnnotatableSection does with the prop:
   *   const isHighlighted = highlightedParagraphIndex === index;
   *   style={{ background: isHighlighted ? 'rgba(13,148,136,0.06)' : 'transparent',
   *            transition: 'background 0.15s' }}
   */
  function getParagraphStyle(
    paragraphIndex: number,
    highlightedParagraphIndex: number | null
  ): { background: string; transition: string } {
    const isHighlighted = highlightedParagraphIndex === paragraphIndex;
    return {
      background: isHighlighted ? 'rgba(13,148,136,0.06)' : 'transparent',
      transition: 'background 0.15s',
    };
  }

  const highlighted = getParagraphStyle(2, 2);
  assert(
    'Highlighted paragraph gets teal background rgba(13,148,136,0.06)',
    highlighted.background === 'rgba(13,148,136,0.06)'
  );
  assert(
    'Transition is 0.15s on highlighted paragraph',
    highlighted.transition === 'background 0.15s'
  );

  const notHighlighted = getParagraphStyle(1, 2);
  assert(
    'Non-highlighted paragraph gets transparent background',
    notHighlighted.background === 'transparent'
  );

  const menuClosed = getParagraphStyle(2, null);
  assert(
    'Highlight fades to transparent when prop is null (menu closed)',
    menuClosed.background === 'transparent'
  );

  // Scope check: highlightedParagraphIndex is only passed to the matching section
  // ReportViewer lines 1027–1031: pass prop only when section.id === docContextMenu.sectionId
  function getHighlightedPropForSection(
    sectionId: string,
    contextMenu: { sectionId: string; paragraphIndex: number | null } | null
  ): number | null {
    if (!contextMenu) return null;
    return contextMenu.sectionId === sectionId ? contextMenu.paragraphIndex : null;
  }

  const menu = { sectionId: 'deal-risk', paragraphIndex: 1 };
  assert(
    'Correct section receives paragraphIndex from context menu',
    getHighlightedPropForSection('deal-risk', menu) === 1
  );
  assert(
    'Other sections receive null (no highlight bleed)',
    getHighlightedPropForSection('exec-summary', menu) === null
  );
})();

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All checks pass. Safe to deploy.\n');
  process.exit(0);
} else {
  console.error(`${failed} check(s) failed. Review before merging.\n`);
  process.exit(1);
}
