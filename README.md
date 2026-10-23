# IP Calculator

An IPv4 subnet calculator that runs in the browser.

- **Terminal**: type an address such as `192.168.1.70/26` to see its class, netmask, wildcard, network, broadcast, host range and scope (private, loopback, CGNAT, documentation, …).
- **Equal subnets**: drag the prefix slider to split the classful network into equal subnets. You get a bit-by-bit view of network, subnet and host bits, a subnet table, and a 3D grid with one block per address.
- **VLSM**: list the subnets you need with their host counts and get the smallest aligned subnet for each, allocated largest first, plus the free space that is left.
- **Reference**: IPv4 address classes and the TCP header layout (RFC 9293).

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

The subnet math lives in `src/subnet.ts`. The DOM-free view helpers (terminal text, grid cells) are in `src/view.ts`, the three.js scene is in `src/subnet3d.ts`, and `src/main.ts` wires up the page.

## Deployment

`.github/workflows/deploy.yml` tests and builds every push and pull request, and deploys `main` to GitHub Pages. To enable it, set the repository's **Settings → Pages → Source** to **GitHub Actions**.
