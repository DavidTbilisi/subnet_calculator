// the Tools section: route summarization, range to CIDR, contains, overlaps and subtract

import { contains, findOverlaps, intToIp, ipToInt, isValidIp, parseCidr, rangeToCidrs, subnetInfo, subtract, summarize, supernet } from './subnet';
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

// networks separated by spaces, commas or new lines; an error message names the ones that do not parse
const parseList = function(text: string): { blocks: CidrBlock[]; error: string | null } {
  const tokens = text.split(/[\s,]+/).filter(token => token !== '');
  const invalid = tokens.filter(token => !parseBlock(token));
  if (tokens.length === 0) {
    return { blocks: [], error: 'Enter one or more IPv4 networks.' };
  }
  if (invalid.length > 0) {
    return { blocks: [], error: `Not an IPv4 network: ${invalid.join(', ')}` };
  }
  return { blocks: tokens.map(token => parseBlock(token)!), error: null };
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
  const overlapsInput = document.getElementById('overlaps-input') as HTMLTextAreaElement;
  const overlapsResult = document.getElementById('overlaps-result') as HTMLElement;
  const subtractFrom = document.getElementById('subtract-from') as HTMLInputElement;
  const subtractExclude = document.getElementById('subtract-exclude') as HTMLInputElement;
  const subtractResult = document.getElementById('subtract-result') as HTMLElement;

  const updateSummarize = function(): void {
    const { blocks, error } = parseList(summarizeInput.value);
    if (error) {
      showResult(summarizeResult, error, true);
      return;
    }

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

  const updateOverlaps = function(): void {
    const { blocks, error } = parseList(overlapsInput.value);
    if (error) {
      showResult(overlapsResult, error, true);
      return;
    }

    const overlaps = findOverlaps(blocks);
    if (overlaps.length === 0) {
      showResult(overlapsResult, `No overlaps among ${blocks.length} ${blocks.length === 1 ? 'network' : 'networks'}.`);
      return;
    }
    // number the networks as listed, so repeated ones can be told apart
    const label = (i: number) => `#${i + 1} ${cidrText(blocks[i])}`;
    const lines = overlaps.map(({ outer, inner, duplicate }) => duplicate
      ? `${label(inner)} duplicates ${label(outer)}`
      : `${label(outer)} contains ${label(inner)}`);
    showResult(overlapsResult, `${lines.join('\n')}\n\n${overlaps.length} ${overlaps.length === 1 ? 'overlap' : 'overlaps'}`, true);
  }

  const updateSubtract = function(): void {
    const from = parseList(subtractFrom.value);
    const exclude = parseList(subtractExclude.value);
    if (from.error || exclude.error) {
      showResult(subtractResult, (from.error ?? exclude.error)!, true);
      return;
    }

    const remaining = subtract(from.blocks, exclude.blocks);
    showResult(subtractResult, remaining.length === 0 ? 'Nothing is left: the exclusions cover every address.' : blockList(remaining));
  }

  summarizeInput.addEventListener('input', updateSummarize);
  [rangeStart, rangeEnd].forEach(input => input.addEventListener('input', updateRange));
  [containsIp, containsNetwork].forEach(input => input.addEventListener('input', updateContains));
  overlapsInput.addEventListener('input', updateOverlaps);
  [subtractFrom, subtractExclude].forEach(input => input.addEventListener('input', updateSubtract));
  updateSummarize();
  updateRange();
  updateContains();
  updateOverlaps();
  updateSubtract();
}
