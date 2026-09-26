# Issue #1160: ordinary editor MCP and Stage proof

`e2e/agent-mcp-replacement.auth.spec.ts` drives an isolated authenticated Show editor with a dynamically registered external MCP client. It seeds synthetic personal Patterns before opening the editor, uses the visible Agent drawer to arm the connection, and applies whole-Show replacements only through MCP. The browser test retains the actual `toBlob` PNGs posted to the capture sink and records their hashes, dimensions, fixed-time settings, exact grid-centre RGBA, safe MCP receipts, and timing in `adoption.json` and `dirty-field.json`.

The expected opaque red and green values are fixture literals. `test-design.json` records the invariants, partitions, sequences, oracles, and limits. The deliberate stale-PNG challenge reuses the prior solid frame against the two-Zone oracle; it checks the oracle's sensitivity and does not claim a product mutation. The unchanged-state recapture reports both exact sampled values and a separate all-image measurement.

The focused isolated browser run passed 2 tests with 1 worker and one synthetic account per test. It retained 10 adoption PNGs and 1 dirty-field PNG. The repeated solid frame had zero changed pixels across its 416×416 image; the stale solid frame failed the right-hand green oracle and a fresh two-Zone frame passed. Both manifests record zero browser errors. The product source base is `c4433f5a`; this slice adds browser qualification and evidence without changing product source.

The scope is Fast 2D plane output at full primary colours. It does not establish aesthetic approval, hardware behaviour, Precise fidelity, or timer expiry. The authenticated fixture owns per-test synthetic account cleanup and Agent registration release; the MCP helper revokes its refresh token.
