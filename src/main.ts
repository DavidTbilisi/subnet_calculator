import './style.scss';
import { classfulPrefix, intToIp, parseCidr, planVlsm, prefixToMask, subnetInfo, subnetLayout } from './subnet';
import type { VlsmRequest } from './subnet';
import { SubnetScene } from './subnet3d';
import { bitRow, blockCidr, classTypes, cssColor, describeSubnet, detectIpClass, escapeHtml, exampleCidr, exampleVlsmCidr, formatCount, subnetCells, vlsmCells, vlsmColors } from './view';

// wire up the page
const ipInput = document.getElementById('ip') as HTMLInputElement;
const ipResult = document.getElementById('ip-result') as HTMLElement;
const section = document.getElementById('subnetting') as HTMLElement;
const note = document.getElementById('subnet-note') as HTMLElement;
const prefixInput = document.getElementById('prefix') as HTMLInputElement;
const prefixValue = document.getElementById('prefix-value') as HTMLElement;
const bits = document.getElementById('subnet-bits') as HTMLElement;
const caption = document.getElementById('subnet-caption') as HTMLElement;
const sceneContainer = document.getElementById('subnet-3d') as HTMLElement;
const tooltip = document.getElementById('subnet-tooltip') as HTMLElement;
const tableWrap = document.getElementById('subnet-table-wrap') as HTMLElement;
const rows = document.getElementById('subnet-rows') as HTMLElement;
const modeButtons = Array.from(document.querySelectorAll('.subnet-mode')) as HTMLButtonElement[];
const vlsmNetworkInput = document.getElementById('vlsm-network') as HTMLInputElement;
const requestRows = document.getElementById('vlsm-requests') as HTMLElement;
const addRequest = document.getElementById('vlsm-add') as HTMLButtonElement;
const vlsmCaption = document.getElementById('vlsm-caption') as HTMLElement;
const vlsmTableWrap = document.getElementById('vlsm-table-wrap') as HTMLElement;
const vlsmRows = document.getElementById('vlsm-rows') as HTMLElement;

// the rest of the page still works if three.js failed to load or WebGL is unavailable
let scene: SubnetScene | null = null;
try {
  scene = new SubnetScene(sceneContainer, tooltip);
} catch (error) {
  sceneContainer.classList.add('subnet-3d-unavailable');
  sceneContainer.textContent = '3D view unavailable in this browser.';
}

// the address currently shown, so the slider can change its prefix
let currentIp = parseCidr(exampleCidr)!.ip;
let mode = 'equal';
const requests: VlsmRequest[] = [
  { name: 'LAN A', hosts: 50 },
  { name: 'LAN B', hosts: 20 },
  { name: 'Link 1', hosts: 2 },
  { name: 'Link 2', hosts: 2 },
];

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

  let summary: string;
  if (prefix < parentPrefix) {
    summary = `${parentCidr} is a supernet: shorter than the classful /${parentPrefix}, so no bits are borrowed.`;
  } else if (prefix === parentPrefix) {
    summary = `${parentCidr} is not subnetted. Drag the slider right to borrow host bits.`;
  } else {
    summary = `${parentCidr} split into ${formatCount(layout.totalSubnets)} × /${prefix} subnets, ${formatCount(subnetInfo(ip, prefix).usableHosts)} usable hosts each.`;
    if (layout.totalSubnets > layout.subnetCount) {
      summary += ` Showing the ${layout.subnetCount} in ${intToIp(layout.blockNetwork)}/${layout.blockPrefix}.`;
    }
  }
  caption.textContent = isExample ? `Example: ${intToIp(ip)}/${prefix}. ${summary}` : summary;

  rows.innerHTML = Array.from({ length: layout.subnetCount }, (_, i) => {
    const info = subnetInfo(layout.blockNetwork + i * subnetSize, prefix);
    return `<tr${i === ipSubnet ? ' class="selected"' : ''}>
      <td>${formatCount(firstIndex + i + 1)}</td>
      <td>${intToIp(info.network)}/${prefix}</td>
      <td>${intToIp(info.firstHost)} - ${intToIp(info.lastHost)}</td>
      <td>${intToIp(info.broadcast)}</td>
    </tr>`;
  }).join('');

  // scroll the table, not the page, to the IP's subnet
  const selected = rows.querySelector('.selected') as HTMLElement;
  tableWrap.scrollTop = selected.offsetTop - tableWrap.clientHeight / 2;

  // label the tiles while there are few enough to read
  const labels = layout.subnetCount <= 16
    ? Array.from({ length: layout.subnetCount }, (_, i) => `#${formatCount(firstIndex + i + 1)}\n${intToIp(layout.blockNetwork + i * subnetSize)}/${prefix}`)
    : [];

  if (scene) {
    scene.update(subnetCells(ip, prefix, layout), labels);
  }
}

const showVlsmError = function(message: string): void {
  section.classList.add('vlsm-error');
  vlsmCaption.textContent = message;
  vlsmRows.innerHTML = '';
}

const renderVlsm = function(): void {
  const cidr = parseCidr(vlsmNetworkInput.value);
  const parentPrefix = cidr ? classfulPrefix(detectIpClass(intToIp(cidr.ip))) : null;
  const valid = requests
    .map((request, i) => ({ name: request.name.trim() || `Subnet ${i + 1}`, hosts: request.hosts }))
    .filter(request => Number.isInteger(request.hosts) && request.hosts >= 1);

  if (!cidr || parentPrefix === null) {
    showVlsmError('Enter a class A, B or C network to divide, e.g. 192.168.1.0/24.');
    return;
  }
  if (valid.length === 0) {
    showVlsmError('Add at least one subnet with 1 or more hosts.');
    return;
  }

  const prefix = cidr.prefix ?? parentPrefix;
  const network = subnetInfo(cidr.ip, prefix).network;
  const size = 2 ** (32 - prefix);
  const plan = planVlsm(network, prefix, valid);

  if (!plan.fits) {
    showVlsmError(`These subnets need ${formatCount(plan.needed)} addresses, but ${intToIp(network)}/${prefix} only has ${formatCount(size)}.`);
    return;
  }

  section.classList.remove('vlsm-error');
  vlsmCaption.textContent = `${valid.length} subnets carved from ${intToIp(network)}/${prefix}: ${formatCount(plan.needed)} of ${formatCount(size)} addresses used, ${formatCount(size - plan.needed)} free.`;

  vlsmRows.innerHTML = plan.blocks.map((block, i) => {
    if (block.name === null) {
      return `<tr class="free">
        <td>free</td>
        <td>${blockCidr(block)}</td>
        <td>${formatCount(2 ** (32 - block.prefix))} addresses</td>
        <td></td>
        <td></td>
      </tr>`;
    }
    const info = subnetInfo(block.network, block.prefix);
    return `<tr>
      <td><span class="swatch" style="background-color: ${cssColor(vlsmColors[i % vlsmColors.length])}"></span>${escapeHtml(block.name)}</td>
      <td>${blockCidr(block)}</td>
      <td>${intToIp(info.firstHost)} - ${intToIp(info.lastHost)}</td>
      <td>${formatCount(block.hosts)}</td>
      <td>${formatCount(info.usableHosts - block.hosts)}</td>
    </tr>`;
  }).join('');

  // label the subnets (not the free space) big enough to hold a label: at least 1/16 of the network
  const labels = plan.blocks.map(block => block.name !== null && 2 ** (32 - block.prefix) >= size / 16 ? `${block.name}\n${blockCidr(block)}` : '');

  if (scene) {
    scene.update(vlsmCells(plan.blocks), labels);
  }
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
      request.hosts = Number(hosts.value);
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

// hovering a subnet in the 3D grid or the table highlights it in both
if (scene) {
  scene.onHoverGroup = highlightRow;
}
[rows, vlsmRows].forEach(tbody => {
  tbody.addEventListener('mouseover', function(e) {
    const row = (e.target as HTMLElement).closest('tr');
    const group = row ? Array.from(tbody.children).indexOf(row) : -1;
    tbody.querySelectorAll('.hovered').forEach(other => other.classList.remove('hovered'));
    row?.classList.add('hovered');
    scene?.highlightGroup(group);
  });
  tbody.addEventListener('mouseleave', function() {
    highlightRow(-1);
    scene?.highlightGroup(-1);
  });
});

const update = function(): void {
  const value = ipInput.value.trim();
  const cidr = parseCidr(value === '' ? exampleCidr : value);

  if (!cidr) {
    // keep the last visualization while the address is being typed
    ipResult.textContent = 'Invalid IP';
    return;
  }

  const ipClass = detectIpClass(intToIp(cidr.ip));
  const parentPrefix = classfulPrefix(ipClass);
  const prefix = cidr.prefix ?? parentPrefix;
  const classLine = ipClass in classTypes ? `Class ${ipClass} (${classTypes[ipClass]})` : ipClass;

  if (value !== '') {
    ipResult.textContent = parentPrefix !== null && prefix !== null ? `${classLine}\n${describeSubnet(cidr.ip, prefix)}` : classLine;
  } else {
    ipResult.textContent = '';
  }

  // VLSM divides its own network, so only the terminal follows the input there
  if (mode !== 'equal') {
    return;
  }

  if (parentPrefix === null || prefix === null) {
    section.classList.add('subnet-disabled');
    note.textContent = ipClass in classTypes
      ? `Class ${ipClass} addresses are ${classTypes[ipClass].toLowerCase()} and are not subnetted.`
      : `${intToIp(cidr.ip)} is reserved and cannot be subnetted.`;
    prefixInput.disabled = true;
    return;
  }

  section.classList.remove('subnet-disabled');
  note.textContent = '';
  prefixInput.disabled = false;
  currentIp = cidr.ip;
  renderSubnetting(cidr.ip, prefix, parentPrefix, value === '');
}

const setMode = function(newMode: string): void {
  mode = newMode;
  section.classList.toggle('mode-vlsm', mode === 'vlsm');
  modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));

  if (mode === 'equal') {
    update();
    return;
  }
  // start VLSM from the class network of the terminal's address
  if (vlsmNetworkInput.value === '') {
    const cidr = parseCidr(ipInput.value);
    const classPrefix = cidr ? classfulPrefix(detectIpClass(intToIp(cidr.ip))) : null;
    vlsmNetworkInput.value = cidr && classPrefix !== null ? `${intToIp(subnetInfo(cidr.ip, classPrefix).network)}/${classPrefix}` : exampleVlsmCidr;
  }
  renderRequests();
  renderVlsm();
}

modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode!)));
vlsmNetworkInput.addEventListener('input', renderVlsm);
addRequest.addEventListener('click', function() {
  requests.push({ name: `Subnet ${requests.length + 1}`, hosts: 10 });
  renderRequests();
  renderVlsm();
  (requestRows.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.select();
});

ipInput.addEventListener('input', update);
prefixInput.addEventListener('input', function() {
  ipInput.value = `${intToIp(currentIp)}/${prefixInput.value}`;
  update();
});

update();
