# Tests

- `unit.js`: date math, locking, overtime, diffs and report periods. Run with `node test/unit.js`.
- `mock.js`: runs the real `engine/Code.gs` against an in-memory copy of the Sheet and serves the site plus a fake API on http://localhost:8787. Start it with `node test/mock.js`.
- `e2e.js` / `signin.js`: Playwright browser tests against the mock. `signin.js` covers sign-in codes, sessions, rate limiting and sign-out. `e2e.js` predates sign-in, so it needs a sign-in step added before it will pass.
  - Run with `npm i playwright`, then `node test/signin.js <screenshot-dir>`.

Test logins (mock only): `tok_intern_sebastian_0001`, `tok_admin_kent_000000000001`, `tok_mgr_manoj_000000000001`. These are fake tokens. The data is anonymized.
