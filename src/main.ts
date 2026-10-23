import './style.scss';
import { classfulPrefix, intToIp, parseCidr, planVlsm, prefixToMask, subnetInfo, subnetLayout } from './subnet';
import type { VlsmRequest } from './subnet';
import { formatIpv6, parseIpv6, subnetInfo6, subnetWindow6 } from './ipv6';
import type { Cell, SubnetScene } from './subnet3d';
import { initPackets } from './packets';
import { initTheme, themeColor } from './theme';
import { initTools } from './tools';
import { decodeState, encodeState } from './urlState';
import type { PageState } from './urlState';
import { bitRow, blockCidr, classTypes, cssColor, describeIpv6, describeScope, describeSubnet, detectIpClass, escapeHtml, exampleCidr, exampleVlsmCidr, formatCount, scopeLine, subnetCells, toCsv, vlsmCells, vlsmColors } from './view';

// wire up the page
const ipInput = document.getElementById('ip') as HTMLInputElement;
const ipResult = document.getElementById('ip-result') as HTMLElement;
const copyButton = document.getElementById('ip-copy') as HTMLButtonElement;
const section = document.getElementById('subnetting') as HTMLElement;
const note = document.getElementById('subnet-note') as HTMLElement;
const prefixInput = document.getElementById('prefix') as HTMLInputElement;
const prefixValue = document.getElementById('prefix-value') as HTMLElement;
const parentInput = document.getElementById('parent') as HTMLInputElement;
const bits = document.getElementById('subnet-bits') as HTMLElement;
const caption = document.getElementById('subnet-caption') as HTMLElement;
const sceneContainer = document.getElementById('subnet-3d') as HTMLElement;
const tooltip = document.getElementById('subnet-tooltip') as HTMLElement;
const tableWrap = document.getElementById('subnet-table-wrap') as HTMLElement;
const head = document.getElementById('subnet-head') as HTMLElement;
const rows = document.getElementById('subnet-rows') as HTMLElement;
const subnetCsvButton = document.getElementById('subnet-csv') as HTMLButtonElement;
const modeButtons = Array.from(document.querySelectorAll('.subnet-mode')) as HTMLButtonElement[];
const vlsmNetworkInput = document.getElementById('vlsm-network') as HTMLInputElement;
const requestRows = document.getElementById('vlsm-requests') as HTMLElement;
const addRequest = document.getElementById('vlsm-add') as HTMLButtonElement;
const allow31Input = document.getElementById('vlsm-p31') as HTMLInputElement;
const vlsmCaption = document.getElementById('vlsm-caption') as HTMLElement;
const vlsmCsvButton = document.getElementById('vlsm-csv') as HTMLButtonElement;
const vlsmTableWrap = document.getElementById('vlsm-table-wrap') as HTMLElement;
const vlsmRows = document.getElementById('vlsm-rows') as HTMLElement;
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;

// three.js is most of the page's code, so the 3D view is loaded once it is about to scroll into view;
// until then (and if WebGL is unavailable) scene is null and the rest of the page works without it
let scene: SubnetScene | null = null;
// what the scene shows, kept so a scene that loads later starts from the current view
let sceneContent: { cells: Cell[]; labels: string[] } | null = null;

// IPv6 networks are split from a /48 (a typical site) unless a parent prefix is set
const defaultParent6 = 48;
// an IPv6 address without a prefix is taken as a /64 (the standard LAN size)
const defaultPrefix6 = 64;

const defaultRequests: VlsmRequest[] = [
  { name: 'LAN A', hosts: 50 },
  { name: 'LAN B', hosts: 20 },
  { name: 'Link 1', hosts: 2 },
  { name: 'Link 2', hosts: 2 },
];
const defaults: PageState = { ip: '', parent: null, mode: 'equal', net: '', requests: defaultRequests, allow31: false };

// the address currently shown (without its prefix), so the slider can change the prefix
let currentAddress = intToIp(parseCidr(exampleCidr)!.ip);
let family: 4 | 6 = 4;
// the parent prefix typed by the user, or null for the default
let parentOverride: number | null = null;
let mode: PageState['mode'] = 'equal';
const requests: VlsmRequest[] = [];

// the CIDR of each row of the equal-subnets table, so clicking a subnet can load it
let equalSubnetCidr: (group: number) => string = () => exampleCidr;
// the VLSM subnet pinned by a click, or -1
let pinnedVlsm = -1;

// the tables as shown, for CSV export
let subnetCsv = { filename: '', rows: [] as string[][] };
let vlsmCsv = { filename: '', rows: [] as string[][] };

const csvFilename = function(cidr: string): string {
  return `subnets-${cidr.replace(/[/:]/g, '_')}.csv`;
}

const downloadCsv = function({ filename, rows }: { filename: string; rows: string[][] }): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const saveState = function(): void {
  const hash = encodeState({ ip: ipInput.value.trim(), parent: parentOverride, mode, net: vlsmNetworkInput.value.trim(), requests, allow31: allow31Input.checked });
  history.replaceState(null, '', hash === '' ? location.pathname + location.search : `#${hash}`);
}

// the address family sets the prefix range; a parent prefix typed for the other family no longer applies
const setFamily = function(newFamily: 4 | 6): void {
  if (newFamily !== family) {
    parentOverride = null;
    parentInput.value = '';
    parentInput.removeAttribute('aria-invalid');
  }
  family = newFamily;
  section.classList.toggle('ipv6', family === 6);
  prefixInput.max = parentInput.max = family === 4 ? '32' : '128';
}

const summarizeSplit = function(parentCidr: string, parentPrefix: number, prefix: number, total: string, each: string, shown: string): string {
  if (prefix < parentPrefix) {
    return `${parentCidr} is a supernet: shorter than the parent /${parentPrefix}, so no bits are borrowed.`;
  }
  if (prefix === parentPrefix) {
    return `${parentCidr} is not subnetted. Drag the slider right to borrow host bits.`;
  }
  return `${parentCidr} split into ${total} × /${prefix} subnets, ${each} each.${shown}`;
}

// the subnet table, scrolled (not the page) so the address's subnet is in view
const renderSubnetTable = function(columns: string[], body: string[][], selected: number, cidr: string): void {
  head.innerHTML = `<tr>${columns.map(column => `<th>${column}</th>`).join('')}</tr>`;
  rows.innerHTML = body.map((cells, i) => `<tr${i === selected ? ' class="selected"' : ''}>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
  subnetCsv = { filename: csvFilename(cidr), rows: [columns, ...body] };

  const row = rows.children[selected] as HTMLElement;
  tableWrap.scrollTop = row.offsetTop - tableWrap.clientHeight / 2;
}

const renderSubnetting = function(ip: number, prefix: number, parentPrefix: number, isExample: boolean): void {
  const layout = subnetLayout(ip, prefix, parentPrefix);
  const parent = Math.min(parentPrefix, prefix);
  const parentCidr = `${intToIp(subnetInfo(ip, parent).network)}/${parent}`;
  const subnetSize = 2 ** (32 - prefix);
  const firstIndex = (layout.blockNetwork - subnetInfo(ip, parent).network) / subnetSize;
  const ipSubnet = Math.floor((ip - layout.blockNetwork) / subnetSize);

  prefixInput.value = String(prefix);
  prefixValue.textContent = `/${prefix}`;
  bits.innerHTML = bitRow('Address', ip, prefix, parent) + bitRow('Mask', prefixToMask(prefix), prefix, parent);

  const shown = layout.totalSubnets > layout.subnetCount ? ` Showing the ${layout.subnetCount} in ${intToIp(layout.blockNetwork)}/${layout.blockPrefix}.` : '';
  const summary = summarizeSplit(parentCidr, parentPrefix, prefix, formatCount(layout.totalSubnets), `${formatCount(subnetInfo(ip, prefix).usableHosts)} usable hosts`, shown);
  caption.textContent = isExample ? `Example: ${intToIp(ip)}/${prefix}. ${summary}` : summary;

  renderSubnetTable(['#', 'Network', 'Hosts', 'Broadcast'], Array.from({ length: layout.subnetCount }, (_, i) => {
    const info = subnetInfo(layout.blockNetwork + i * subnetSize, prefix);
    return [formatCount(firstIndex + i + 1), `${intToIp(info.network)}/${prefix}`, `${intToIp(info.firstHost)} - ${intToIp(info.lastHost)}`, intToIp(info.broadcast)];
  }), ipSubnet, parentCidr);
  equalSubnetCidr = group => `${intToIp(layout.blockNetwork + group * subnetSize)}/${prefix}`;

  // label the tiles while there are few enough to read
  const labels = layout.subnetCount <= 16
    ? Array.from({ length: layout.subnetCount }, (_, i) => `#${formatCount(firstIndex + i + 1)}\n${intToIp(layout.blockNetwork + i * subnetSize)}/${prefix}`)
    : [];

  drawScene(subnetCells(ip, prefix, layout), labels);
}

// IPv6 gets the caption and table only: 128 bits and 2^64-address subnets do not fit the bit view or the grid
const renderSubnetting6 = function(ip: bigint, prefix: number, parentPrefix: number): void {
  const slice = subnetWindow6(ip, prefix, parentPrefix);
  const parent = Math.min(parentPrefix, prefix);
  const parentCidr = `${formatIpv6(subnetInfo6(ip, parent).network)}/${parent}`;
  const subnetSize = 1n << BigInt(128 - prefix);
  const ipSubnet = Number((subnetInfo6(ip, prefix).network - slice.blockNetwork) / subnetSize);

  prefixInput.value = String(prefix);
  prefixValue.textContent = `/${prefix}`;

  const shown = slice.totalSubnets > BigInt(slice.subnetCount) ? ` Showing the ${slice.subnetCount} in ${formatIpv6(slice.blockNetwork)}/${slice.blockPrefix}.` : '';
  caption.textContent = summarizeSplit(parentCidr, parentPrefix, prefix, slice.totalSubnets.toLocaleString('en-US'), `2^${128 - prefix} addresses`, shown);

  renderSubnetTable(['#', 'Network', 'Last address'], Array.from({ length: slice.subnetCount }, (_, i) => {
    const info = subnetInfo6(slice.blockNetwork + BigInt(i) * subnetSize, prefix);
    return [(slice.firstIndex + BigInt(i) + 1n).toLocaleString('en-US'), `${formatIpv6(info.network)}/${prefix}`, formatIpv6(info.last)];
  }), ipSubnet, parentCidr);
  equalSubnetCidr = group => `${formatIpv6(slice.blockNetwork + BigInt(group) * subnetSize)}/${prefix}`;
}

const showVlsmError = function(message: string): void {
  section.classList.add('vlsm-error');
  vlsmCaption.textContent = message;
  vlsmRows.innerHTML = '';
}

const renderVlsm = function(): void {
  saveState();
  const cidr = parseCidr(vlsmNetworkInput.value);
  const parentPrefix = cidr ? classfulPrefix(detectIpClass(intToIp(cidr.ip))) : null;
  const named = requests.map((request, i) => ({ name: request.name.trim() || `Subnet ${i + 1}`, hosts: request.hosts }));
  const invalid = named.filter(request => !Number.isInteger(request.hosts) || request.hosts < 1);

  requestRows.querySelectorAll('input[type="number"]').forEach((input, i) => input.setAttribute('aria-invalid', String(invalid.includes(named[i]))));

  if (!cidr || parentPrefix === null) {
    showVlsmError('Enter a class A, B or C network to divide, e.g. 192.168.1.0/24.');
    return;
  }
  if (named.length === 0) {
    showVlsmError('Add at least one subnet.');
    return;
  }
  if (invalid.length > 0) {
    showVlsmError(`Hosts needed must be a whole number of 1 or more: check ${invalid.map(request => request.name).join(', ')}.`);
    return;
  }

  const prefix = cidr.prefix ?? parentPrefix;
  const network = subnetInfo(cidr.ip, prefix).network;
  const size = 2 ** (32 - prefix);
  const plan = planVlsm(network, prefix, named, allow31Input.checked);

  if (!plan.fits) {
    showVlsmError(`These subnets need ${formatCount(plan.needed)} addresses, but ${intToIp(network)}/${prefix} only has ${formatCount(size)}.`);
    return;
  }

  section.classList.remove('vlsm-error');
  vlsmCaption.textContent = `${named.length} subnets carved from ${intToIp(network)}/${prefix}: ${formatCount(plan.needed)} of ${formatCount(size)} addresses used, ${formatCount(size - plan.needed)} free.`;

  const table = plan.blocks.map(block => {
    if (block.name === null) {
      return ['free', blockCidr(block), `${formatCount(2 ** (32 - block.prefix))} addresses`, '', ''];
    }
    const info = subnetInfo(block.network, block.prefix);
    return [block.name, blockCidr(block), `${intToIp(info.firstHost)} - ${intToIp(info.lastHost)}`, formatCount(block.hosts), formatCount(info.usableHosts - block.hosts)];
  });
  vlsmCsv = { filename: csvFilename(`${intToIp(network)}/${prefix}`), rows: [['Subnet', 'Network', 'Hosts', 'Needed', 'Spare'], ...table] };

  vlsmRows.innerHTML = table.map(([name, ...cells], i) => plan.blocks[i].name === null
    ? `<tr class="free"><td>${name}</td>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`
    : `<tr><td><span class="swatch" style="background-color: ${cssColor(vlsmColors[i % vlsmColors.length])}"></span>${escapeHtml(name)}</td>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`
  ).join('');

  // label the subnets (not the free space) big enough to hold a label: at least 1/16 of the network
  const labels = plan.blocks.map(block => block.name !== null && 2 ** (32 - block.prefix) >= size / 16 ? `${block.name}\n${blockCidr(block)}` : '');

  drawScene(vlsmCells(plan.blocks), labels);
  pinnedVlsm = -1;
}

// one editable row per requested subnet
const renderRequests = function(): void {
  requestRows.replaceChildren(...requests.map(request => {
    const name = Object.assign(document.createElement('input'), { type: 'text', value: request.name, spellcheck: false });
    name.setAttribute('aria-label', 'Subnet name');
    name.addEventListener('input', () => {
      request.name = name.value;
      renderVlsm();
    });

    const hosts = Object.assign(document.createElement('input'), { type: 'number', min: '1', value: String(request.hosts) });
    hosts.setAttribute('aria-label', 'Hosts needed');
    hosts.addEventListener('input', () => {
      request.hosts = hosts.value === '' ? NaN : Number(hosts.value);
      renderVlsm();
    });

    const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Remove subnet' });
    remove.setAttribute('aria-label', 'Remove subnet');
    remove.addEventListener('click', () => {
      requests.splice(requests.indexOf(request), 1);
      renderRequests();
      renderVlsm();
    });

    const row = document.createElement('tr');
    [name, hosts, remove].forEach(control => row.appendChild(document.createElement('td')).appendChild(control));
    return row;
  }));
}

// the table that matches the 3D grid in the current mode
const activeTable = function(): { rows: HTMLElement; wrap: HTMLElement } {
  return mode === 'equal' ? { rows, wrap: tableWrap } : { rows: vlsmRows, wrap: vlsmTableWrap };
}

// mark a subnet's table row, scrolling the table (not the page) if the row is out of view; -1 clears it
const highlightRow = function(group: number): void {
  const { rows, wrap } = activeTable();
  rows.querySelectorAll('.hovered').forEach(row => row.classList.remove('hovered'));
  const row = rows.children[group] as HTMLElement | undefined;
  if (!row) {
    return;
  }
  row.classList.add('hovered');
  if (row.offsetTop < wrap.scrollTop || row.offsetTop + row.offsetHeight > wrap.scrollTop + wrap.clientHeight) {
    wrap.scrollTop = row.offsetTop - wrap.clientHeight / 2;
  }
}

// clicking a subnet loads it into the terminal in equal mode, and pins it (or unpins it) in VLSM
const selectGroup = function(group: number): void {
  if (mode === 'equal') {
    if (group >= 0) {
      ipInput.value = equalSubnetCidr(group);
      update();
    }
    return;
  }
  pinnedVlsm = group === pinnedVlsm ? -1 : group;
  Array.from(vlsmRows.children).forEach((row, i) => row.classList.toggle('selected', i === pinnedVlsm));
  scene?.pinGroup(pinnedVlsm);
}

// hovering a subnet in the table highlights it in the 3D grid, and clicking selects it
for (const tbody of [rows, vlsmRows]) {
  tbody.addEventListener('mouseover', function(e) {
    const row = (e.target as HTMLElement).closest('tr');
    const group = row ? Array.from(tbody.children).indexOf(row) : -1;
    tbody.querySelectorAll('.hovered').forEach(other => other.classList.remove('hovered'));
    row?.classList.add('hovered');
    scene?.highlightGroup(group);
  });
  tbody.addEventListener('click', function(e) {
    const row = (e.target as HTMLElement).closest('tr');
    if (row) {
      selectGroup(Array.from(tbody.children).indexOf(row));
    }
  });
  tbody.addEventListener('mouseleave', function() {
    highlightRow(-1);
    scene?.highlightGroup(-1);
  });
}

const drawScene = function(cells: Cell[], labels: string[]): void {
  sceneContent = { cells, labels };
  scene?.update(cells, labels);
}

const loadScene = async function(): Promise<void> {
  sceneContainer.classList.add('subnet-3d-loading');
  try {
    const { SubnetScene } = await import('./subnet3d');
    scene = new SubnetScene(sceneContainer, tooltip);
  } catch (error) {
    sceneContainer.classList.add('subnet-3d-unavailable');
    sceneContainer.textContent = '3D view unavailable in this browser.';
    return;
  } finally {
    sceneContainer.classList.remove('subnet-3d-loading');
  }

  // hovering a subnet in the 3D grid or the table highlights it in both
  scene.onHoverGroup = highlightRow;
  scene.onSelectGroup = selectGroup;
  scene.setBackground(themeColor('--scene-bg'));
  if (sceneContent) {
    scene.update(sceneContent.cells, sceneContent.labels);
  }
  scene.pinGroup(mode === 'vlsm' ? pinnedVlsm : -1);
}

const showInvalid = function(): void {
  // keep the last visualization while the address is being typed
  ipResult.textContent = 'Invalid IP';
  copyButton.hidden = true;
}

const updateIpv4 = function(value: string): void {
  const cidr = parseCidr(value === '' ? exampleCidr : value);
  if (!cidr) {
    showInvalid();
    return;
  }
  setFamily(4);

  const ipClass = detectIpClass(intToIp(cidr.ip));
  const classPrefix = classfulPrefix(ipClass);
  const prefix = cidr.prefix ?? classPrefix;
  const classLine = ipClass in classTypes ? `Class ${ipClass} (${classTypes[ipClass]})` : ipClass;

  ipResult.textContent = value === '' ? '' : `${classLine}\n${classPrefix !== null && prefix !== null ? describeSubnet(cidr.ip, prefix) : scopeLine(cidr.ip)}`;
  copyButton.hidden = value === '';

  // VLSM divides its own network, so only the terminal follows the input there
  if (mode !== 'equal') {
    return;
  }

  if (classPrefix === null || prefix === null) {
    section.classList.add('subnet-disabled');
    note.textContent = ipClass in classTypes
      ? `Class ${ipClass} addresses are ${classTypes[ipClass].toLowerCase()} and are not subnetted.`
      : `${intToIp(cidr.ip)} is reserved (${describeScope(cidr.ip)}) and cannot be subnetted.`;
    prefixInput.disabled = true;
    return;
  }

  section.classList.remove('subnet-disabled');
  note.textContent = '';
  prefixInput.disabled = false;
  parentInput.placeholder = String(classPrefix);
  currentAddress = intToIp(cidr.ip);
  renderSubnetting(cidr.ip, prefix, parentOverride ?? classPrefix, value === '');
}

const updateIpv6 = function(value: string): void {
  const cidr = parseIpv6(value);
  if (!cidr) {
    showInvalid();
    return;
  }
  setFamily(6);

  const prefix = cidr.prefix ?? defaultPrefix6;
  ipResult.textContent = `IPv6\n${describeIpv6(cidr.ip, prefix)}`;
  copyButton.hidden = false;

  if (mode !== 'equal') {
    return;
  }

  const parentPrefix = Math.min(defaultParent6, prefix);
  section.classList.remove('subnet-disabled');
  note.textContent = '';
  prefixInput.disabled = false;
  parentInput.placeholder = String(parentPrefix);
  currentAddress = formatIpv6(cidr.ip);
  renderSubnetting6(cidr.ip, prefix, parentOverride ?? parentPrefix);
}

const update = function(): void {
  const value = ipInput.value.trim();
  if (value.includes(':')) {
    updateIpv6(value);
  } else {
    updateIpv4(value);
  }
  saveState();
}

const setMode = function(newMode: PageState['mode']): void {
  mode = newMode;
  section.classList.toggle('mode-vlsm', mode === 'vlsm');
  modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));

  // start VLSM from the class network of the terminal's address
  if (mode === 'vlsm' && vlsmNetworkInput.value === '') {
    const cidr = parseCidr(ipInput.value);
    const classPrefix = cidr ? classfulPrefix(detectIpClass(intToIp(cidr.ip))) : null;
    vlsmNetworkInput.value = cidr && classPrefix !== null ? `${intToIp(subnetInfo(cidr.ip, classPrefix).network)}/${classPrefix}` : exampleVlsmCidr;
  }

  // the terminal always follows the input; the equal-subnet view only in its own mode
  update();
  if (mode === 'vlsm') {
    renderRequests();
    renderVlsm();
  }
}

const applyState = function(state: PageState): void {
  ipInput.value = state.ip;
  setFamily(state.ip.includes(':') ? 6 : 4);
  parentOverride = state.parent !== null && state.parent <= Number(parentInput.max) ? state.parent : null;
  parentInput.value = parentOverride === null ? '' : String(parentOverride);
  vlsmNetworkInput.value = state.net;
  requests.splice(0, requests.length, ...state.requests.map(request => ({ ...request })));
  allow31Input.checked = state.allow31;
  setMode(state.mode);
}

modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode as PageState['mode'])));
vlsmNetworkInput.addEventListener('input', renderVlsm);
allow31Input.addEventListener('change', renderVlsm);
addRequest.addEventListener('click', function() {
  requests.push({ name: `Subnet ${requests.length + 1}`, hosts: 10 });
  renderRequests();
  renderVlsm();
  (requestRows.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.select();
});

ipInput.addEventListener('input', update);
prefixInput.addEventListener('input', function() {
  ipInput.value = `${currentAddress}/${prefixInput.value}`;
  update();
});
parentInput.addEventListener('input', function() {
  const parent = Number(parentInput.value);
  const valid = parentInput.value !== '' && Number.isInteger(parent) && parent >= 0 && parent <= Number(parentInput.max);
  parentInput.setAttribute('aria-invalid', String(parentInput.value !== '' && !valid));
  parentOverride = valid ? parent : null;
  update();
});

copyButton.addEventListener('click', async function() {
  try {
    await navigator.clipboard.writeText(ipResult.textContent ?? '');
    copyButton.textContent = 'Copied';
  } catch (error) {
    copyButton.textContent = 'Copy failed';
  }
  setTimeout(() => copyButton.textContent = 'Copy', 1500);
});
subnetCsvButton.addEventListener('click', () => downloadCsv(subnetCsv));
vlsmCsvButton.addEventListener('click', () => downloadCsv(vlsmCsv));

// a pasted link with a different hash reloads the state
window.addEventListener('hashchange', () => applyState(decodeState(location.hash, defaults)));

applyState(decodeState(location.hash, defaults));
initTools();
initPackets();
initTheme(themeToggle, () => scene?.setBackground(themeColor('--scene-bg')));

// start loading a little before the grid is visible; it is hidden for IPv6, so that waits until it is shown
const sceneObserver = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) {
    sceneObserver.disconnect();
    loadScene();
  }
}, { rootMargin: '300px' });
sceneObserver.observe(sceneContainer);
