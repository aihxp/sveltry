---
'@aihxp/sveltry-sdk': minor
---

Add `uploadSourceMaps()` to publish a release's source maps from CI, and `parseDsn()` to read a DSN's origin, public key, and project id. Sveltry resolves minified JavaScript stack frames to original source on ingest using the uploaded maps.
