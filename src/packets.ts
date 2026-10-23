// the Packet Headers section: reference grids for each header and the packet decoder

import { decodePacket, examplePackets, headerGrid, headerLayouts, hexDump, parseHex } from './headers';
import type { HeaderKind } from './headers';
import { escapeHtml } from './view';

// the first bytes of a payload worth showing
const payloadPreview = 256;

export const initPackets = function(): void {
  const tabs = Array.from(document.querySelectorAll('.header-tab')) as HTMLButtonElement[];
  const about = document.getElementById('header-about') as HTMLElement;
  const grid = document.getElementById('header-grid') as HTMLElement;
  const note = document.getElementById('header-note') as HTMLElement;
  const input = document.getElementById('decode-input') as HTMLTextAreaElement;
  const start = document.getElementById('decode-start') as HTMLSelectElement;
  const examples = document.getElementById('decode-examples') as HTMLElement;
  const output = document.getElementById('decode-output') as HTMLElement;

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
      output.innerHTML = `<p class="decode-note warning">${escapeHtml(bytes)}</p>`;
      return;
    }

    const packet = decodePacket(bytes, start.value as HeaderKind | 'auto');
    const notes = packet.notes.map(entry => `<li class="decode-note${entry.warning ? ' warning' : ''}">${escapeHtml(entry.text)}</li>`).join('');
    const layers = packet.layers.map(layer => `
      <h4>${layer.title} <span class="decode-size">${layer.length} bytes</span></h4>
      <div class="header-scroll"><div class="header-grid">${headerGrid(layer.cells)}</div></div>`).join('');
    const shown = packet.payload.subarray(0, payloadPreview);
    const more = packet.payload.length > payloadPreview ? `\n… ${packet.payload.length - payloadPreview} more bytes` : '';
    const payload = packet.layers.length === 0 ? ''
      : packet.payload.length === 0 ? '<p class="decode-size">No payload.</p>'
      : `<h4>Payload <span class="decode-size">${packet.payload.length} bytes</span></h4><pre class="decode-payload">${escapeHtml(hexDump(shown) + more)}</pre>`;

    output.innerHTML = `<p class="decode-size">${bytes.length} bytes pasted.</p>${notes ? `<ul class="decode-notes">${notes}</ul>` : ''}${layers}${payload}`;
  }

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

  showHeader('tcp');
  input.value = examplePackets.syn.hex;
  decode();
}
