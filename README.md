# IP Calculator

An IPv4 and IPv6 subnet calculator that runs in the browser.

**Live site: <https://davidtbilisi.github.io/subnet_calculator/>**

- **Terminal**: type an IPv4 address such as `192.168.1.70/26` to see its class, netmask, wildcard, network, broadcast, host range and scope (private, loopback, CGNAT, documentation, …). An IPv6 address such as `2001:db8::1/64` shows its compressed and expanded forms, network, last address, size and scope. **Copy** puts the output on the clipboard.
- **Equal subnets**: drag the prefix slider to split a network into equal subnets. The parent defaults to the classful network (/48 for IPv6); set the parent prefix to split any block. You get a bit-by-bit view of network, subnet and host bits, a subnet table you can export as CSV, and a 3D grid with one block per address (IPv4).
- **VLSM**: list the subnets you need with their host counts and get the smallest aligned subnet for each, allocated largest first, plus the free space that is left. Two-host links can optionally use /31 (RFC 3021).
- **Tools**: summarize routes into the fewest CIDR blocks, turn an address range into CIDR blocks, and check whether an address is in a network.
- **Shareable links**: the address, parent prefix, mode and VLSM plan are kept in the URL, so a copied link reopens the same view.
- **Reference**: IPv4 address classes and the TCP header layout (RFC 9293), with a description of every field and flag on hover.
- **3D grid**: drag to rotate, pinch or Ctrl + scroll to zoom, click a block or table row to select its subnet. When the grid has focus, the arrow keys rotate, + and - zoom, [ and ] step through subnets, and Enter selects.
- **Light and dark themes**: the page follows the system setting until you pick one with the toggle in the terminal header.

## Development

Requires Node 20 or newer.

```sh
npm install
npm run dev            # dev server with hot reload
npm test               # unit tests (Vitest)
npm run test:coverage  # tests with a coverage report in coverage/
npm run build          # type-check and build into dist/
npm run preview        # serve the production build
```

The IPv4 subnet math lives in `src/subnet.ts` and the IPv6 math in `src/ipv6.ts`. The DOM-free view helpers (terminal text, grid cells) are in `src/view.ts`, the three.js scene is in `src/subnet3d.ts`, and `src/main.ts` wires up the page (with `src/tools.ts` for the Tools section and `src/urlState.ts` for the URL hash).

## Deployment

`.github/workflows/deploy.yml` tests and builds every push and pull request, and deploys `main` to GitHub Pages at <https://davidtbilisi.github.io/subnet_calculator/>. To enable it, set the repository's **Settings → Pages → Source** to **GitHub Actions**.
