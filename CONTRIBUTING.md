# Contributing to ClipShelf

Thanks for helping improve ClipShelf.

## Report an issue

Use GitHub Issues for reproducible bugs and feature requests. Include your Windows version, ClipShelf version, steps to reproduce, and the result you expected. Do not attach clipboard contents, screenshots with private data, history files, or credentials.

## Make a change

1. Fork the repository and create a branch for your change.
2. Keep changes focused and explain user-visible behavior in the pull request.
3. Run `npm ci` and `npm test` on Windows.
4. For changes to native clipboard or paste handling, run `npm run verify:clipboard` and `npm run verify:paste` on an interactive Windows desktop. The paste check currently requires a foreground-capable session.
5. Open a pull request with a short summary and the checks you ran.

## Project boundaries

ClipShelf is a local-first project. Do not add cloud transmission, telemetry, or clipboard-content logging without prior discussion in an issue. Never commit user clipboard history, test output containing personal information, build output, or reverse-engineering evidence bundles.
