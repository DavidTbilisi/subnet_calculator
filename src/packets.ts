// the Packet Headers section: reference grids for each header, and the packet decoder with its 3D bit view

import { decodePacket, examplePackets, firstGroups, headerGrid, headerLayouts, hexDump, packetCells, parseHex } from './headers';
import type { HeaderKind } from './headers';
import { loadSceneWhenVisible } from './sceneLoader';
import type { Cell, SubnetScene } from './subnet3d';
import { escapeHtml } from './view';

// the first bytes of a payload worth showing
const payloadPreview = 256;

// the 3D view faces the rows head on, like the grids, and sits closer than for a square grid of the same width
const packetView = { azimuth: 0, polar: 0.8, distanceScale: 0.75 };

export const initPackets = function(): void {
  const tabs = Array.from(document.querySelectorAll('.header-tab')) as HTMLButtonElement[];
  const about = document.getElementById('header-about') as HTMLElement;
  const grid = document.getElementById('header-grid') as HTMLElement;
  const note = document.getElementById('header-note') as HTMLElement;
  const input = document.getElementById('decode-input') as HTMLTextAreaElement;
  const start = document.getElementById('decode-start') as HTMLSelectElement;
  const examples = document.getElementById('decode-examples') as HTMLElement;
  const summary = document.getElementById('decode-summary') as HTMLElement;
  const sceneWrap = document.getElementById('packet-3d-wrap') as HTMLElement;
  const sceneContainer = document.getElementById('packet-3d') as HTMLElement;
  const tooltip = document.getElementById('packet-tooltip') as HTMLElement;
  const output = document.getElementById('decode-output') as HTMLElement;

  let scene: SubnetScene | null = null;
  let sceneContent: { cells: Cell[]; labels: string[] } | null = null;
  // the field pinned by a click, or -1
  let pinned = -1;

  // marks a field (or the payload) in the grids below; -1 clears the mark
  const markField = function(group: number, mark: 'hovered' | 'pinned'): void {
    output.querySelectorAll(`.${mark}`).forEach(element => element.classList.remove(mark));
    output.querySelector(`[data-group="${group}"]`)?.classList.add(mark);
  }

  const pinField = function(group: number): void {
    pinned = group === pinned ? -1 : group;
    markField(pinned, 'pinned');
    scene?.pinGroup(pinned);
  }

  const showHeader = function(kind: HeaderKind): void {
    const layout = headerLayouts[kind];
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.header === kind)));
    about.innerHTML = layout.about;
    grid.innerHTML = headerGrid(layout.fields);
    note.innerHTML = `Rows are byte offsets and columns are bit numbers; hover a field for a description. ${layout.note}`;
  }

  const decode = function(): void {
    const bytes = parseHex(input.value);
    if (typeof bytes === 'string') {
      summary.innerHTML = `<p class="decode-note warning">${escapeHtml(bytes)}</p>`;
      output.innerHTML = '';
      sceneWrap.hidden = true;
      return;
    }

    const packet = decodePacket(bytes, start.value as HeaderKind | 'auto');
    const notes = packet.notes.map(entry => `<li class="decode-note${entry.warning ? ' warning' : ''}">${escapeHtml(entry.text)}</li>`).join('');
    const groups = firstGroups(packet);
    const layers = packet.layers.map((layer, i) => `
      <h4>${layer.title} <span class="decode-size">${layer.length} bytes</span></h4>
      <div class="header-scroll"><div class="header-grid">${headerGrid(layer.cells, groups[i])}</div></div>`).join('');
    const shown = packet.payload.subarray(0, payloadPreview);
    const more = packet.payload.length > payloadPreview ? `\n… ${packet.payload.length - payloadPreview} more bytes` : '';
    const payload = packet.layers.length === 0 ? ''
      : packet.payload.length === 0 ? '<p class="decode-size">No payload.</p>'
      : `<h4>Payload <span class="decode-size">${packet.payload.length} bytes</span></h4><pre class="decode-payload" data-group="${groups[packet.layers.length]}">${escapeHtml(hexDump(shown) + more)}</pre>`;

    summary.innerHTML = `<p class="decode-size">${bytes.length} bytes pasted.</p>${notes ? `<ul class="decode-notes">${notes}</ul>` : ''}`;
    output.innerHTML = `${layers}${payload}`;

    pinned = -1;
    sceneWrap.hidden = packet.layers.length === 0;
    if (packet.layers.length > 0) {
      sceneContent = packetCells(packet);
      scene?.update(sceneContent.cells, sceneContent.labels);
    }
  }

  // hovering a field in the grids highlights its bits in the 3D view, and clicking pins it
  output.addEventListener('mouseover', e => {
    const field = (e.target as HTMLElement).closest('[data-group]') as HTMLElement | null;
    const group = field ? Number(field.dataset.group) : -1;
    markField(group, 'hovered');
    scene?.highlightGroup(group);
  });
  output.addEventListener('mouseleave', () => {
    markField(-1, 'hovered');
    scene?.highlightGroup(-1);
  });
  output.addEventListener('click', e => {
    const field = (e.target as HTMLElement).closest('[data-group]') as HTMLElement | null;
    if (field) {
      pinField(Number(field.dataset.group));
    }
  });

  tabs.forEach(tab => tab.addEventListener('click', () => showHeader(tab.dataset.header as HeaderKind)));

  examples.replaceChildren(...Object.values(examplePackets).map(example => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: example.label, className: 'decode-example' });
    button.addEventListener('click', () => {
      input.value = example.hex;
      start.value = 'auto';
      decode();
    });
    return button;
  }));
  input.addEventListener('input', decode);
  start.addEventListener('change', decode);

  loadSceneWhenVisible(sceneContainer, tooltip, loaded => {
    scene = loaded;
    scene.onHoverGroup = group => markField(group, 'hovered');
    scene.onSelectGroup = pinField;
    if (sceneContent) {
      scene.update(sceneContent.cells, sceneContent.labels);
    }
  }, packetView);

  showHeader('tcp');
  input.value = examplePackets.syn.hex;
  decode();
}
