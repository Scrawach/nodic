# Throwaway collaboration prototype

Open `collaboration.html` directly in a browser. No server, installation, or network connection is needed.

The two Yjs replicas are real. Network delivery and graph authority are simulated in memory. This is not the Nodic editor and it does not measure network throughput or database durability.

To recreate the single HTML file, run `python assemble.py`. No build tool or package installation is required.

`model.mjs` is the isolated state model. `shell.html` is the presentation. `observations.json` records the guided walkthrough results from Edge. The raw vendor module is input to assembly and is not a standalone Node entry point.

Third-party code: Yjs 13.6.32 prebuilt ESM bundle from https://esm.sh/yjs@13.6.32/es2022/yjs.bundle.mjs (includes lib0). Assembly supplies the browser environment fields used by that bundle and inlines its exports. See THIRD-PARTY-NOTICES.md.

Vendor SHA-256: 2bed4e36c7ed6d6e6a3784e6fd33906f2b2368413881fc01a94de511ca52b29c
