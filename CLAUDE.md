# CLAUDE.md

## Git

Pushing is granted in this repo (Kelvin, 2026-10-14). `main` is protected, so
work lands through a PR from a branch pushed with `git push -u origin <branch>`.

Releases are tag-driven. `v*` builds the bridge and the macOS, Linux and Windows
packages and publishes `@kelnishi/satmouse`; `client-v*` publishes
`@kelnishi/satmouse-client`, and is tagged only when the client changed. The
bridge, client, both extension `manifest.json` files and `Info.plist` share one
version.

## Gates

```sh
npx tsc --noEmit
npm test
npm run build
```
