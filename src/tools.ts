// the Tools section: route summarization, range to CIDR, and contains

import { contains, intToIp, ipToInt, isValidIp, parseCidr, rangeToCidrs, subnetInfo, summarize, supernet } from './subnet';
import type { CidrBlock } from './subnet';
import { formatCount } from './view';

const cidrText = function(block: CidrBlock): string {
  return `${intToIp(block.network)}/${block.prefix}`;
}

const blockSize = function(block: CidrBlock): number {
  return 2 ** (32 - block.prefix);
}

// "10.0.0.0/8" as a block; a bare address is a /32
const parseBlock = function(text: string): CidrBlock | null {
  const cidr = parseCidr(text);
  if (!cidr) {
    return null;
  }
  const prefix = cidr.prefix ?? 32;
  return { network: subnetInfo(cidr.ip, prefix).network, prefix };
}

const showResult = function(element: HTMLElement, text: string, isError = false): void {
  element.textContent = text;
  element.classList.toggle('tool-error', isError);
}

const blockList = function(blocks: CidrBlock[]): string {
  const total = blocks.reduce((sum, block) => sum + blockSize(block), 0);
  return `${blocks.map(cidrText).join('\n')}\n\n${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}, ${formatCount(total)} addresses`;
}

export const initTools = function(): void {
  const summarizeInput = document.getElementById('summarize-input') as HTMLTextAreaElement;
  const summarizeResult = document.getElementById('summarize-result') as HTMLElement;
  const rangeStart = document.getElementById('range-start') as HTMLInputElement;
  const rangeEnd = document.getElementById('range-end') as HTMLInputElement;
  const rangeResult = document.getElementById('range-result') as HTMLElement;
  const containsIp = document.getElementById('contains-ip') as HTMLInputElement;
  const containsNetwork = document.getElementById('contains-network') as HTMLInputElement;
  const containsResult = document.getElementById('contains-result') as HTMLElement;

  const updateSummarize = function(): void {
    const tokens = summarizeInput.value.split(/[\s,]+/).filter(token => token !== '');
    const invalid = tokens.filter(token => !parseBlock(token));
    if (tokens.length === 0) {
      showResult(summarizeResult, 'Enter one or more IPv4 networks.', true);
      return;
    }
    if (invalid.length > 0) {
      showResult(summarizeResult, `Not an IPv4 network: ${invalid.join(', ')}`, true);
      return;
    }

    const blocks = tokens.map(token => parseBlock(token)!);
    const summary = summarize(blocks);
    const covering = supernet(blocks);
    const extra = blockSize(covering) - summary.reduce((sum, block) => sum + blockSize(block), 0);
    showResult(summarizeResult, `${blockList(summary)}\n\nSmallest single supernet: ${cidrText(covering)}${extra > 0 ? `\n(includes ${formatCount(extra)} addresses not in the list)` : ''}`);
  }

  const updateRange = function(): void {
    const start = rangeStart.value.trim();
    const end = rangeEnd.value.trim();
    if (!isValidIp(start) || !isValidIp(end)) {
      showResult(rangeResult, 'Enter two IPv4 addresses.', true);
      return;
    }
    if (ipToInt(start) > ipToInt(end)) {
      showResult(rangeResult, 'The first address must not come after the last.', true);
      return;
    }
    showResult(rangeResult, blockList(rangeToCidrs(ipToInt(start), ipToInt(end))));
  }

  const updateContains = function(): void {
    const ip = containsIp.value.trim();
    const block = parseBlock(containsNetwork.value.trim());
    if (!isValidIp(ip) || !block) {
      showResult(containsResult, 'Enter an IPv4 address and a network such as 10.0.0.0/8.', true);
      return;
    }
    const info = subnetInfo(block.network, block.prefix);
    const verdict = contains(block, ipToInt(ip)) ? 'is in' : 'is not in';
    showResult(containsResult, `${ip} ${verdict} ${cidrText(block)}\n(${intToIp(info.network)} - ${intToIp(info.broadcast)})`);
  }

  summarizeInput.addEventListener('input', updateSummarize);
  [rangeStart, rangeEnd].forEach(input => input.addEventListener('input', updateRange));
  [containsIp, containsNetwork].forEach(input => input.addEventListener('input', updateContains));
  updateSummarize();
  updateRange();
  updateContains();
}
