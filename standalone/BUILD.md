# Standalone Windows build

The distributed file is `DeGolyer-Sudoku-Server.exe` in the workspace root. It embeds Node.js, SQLite, the server/API, the complete browser game, database migrations, and third-party license notices. Running it does not require Node.js, npm, a package install, or a cloud connection. Its writable classroom database is created separately in `SudokuData` beside the EXE.

To rebuild from source on Windows x64:

1. Use Windows x64 Node.js 24 and the project's existing dependencies.
2. Install `postject` in the workspace `.tooling/sea-tools` directory. This build tool is not needed by the finished EXE.
3. Run `node standalone/build.mjs` from the project directory. The script bundles the React client, replaces cloud bindings with local adapters, creates the Node SEA blob, injects it into a fresh copy of Node, and copies the result to the workspace root.

`SUDOKU_NODE_BINARY` may point to the Node binary to embed. `SUDOKU_POSTJECT_CLI` may point to Postject's `dist/cli.js`. `node standalone/build.mjs --web-only` prepares embedded web assets and migration manifests without building the EXE.

Generated build output, the preparation blob, asset/migration manifests, and `build-info.json` live in the ignored `outputs/standalone` folder. Build inputs do not include the live classroom database or teacher password. The browser bundle loads all fonts/styles/scripts locally and obtains the server's LAN origin before creating classroom share links.

The hosted application's source remains unchanged. Build-time adapters use the same Sudoku API and record logic with local SQLite, and replace hosted teacher authentication with the standalone server's local password flow.

Packaging follows the [Node.js 24 single-executable documentation](https://nodejs.org/download/release/v24.18.0/docs/api/single-executable-applications.html). Third-party notices are embedded and available at `/licenses.txt` on the running server.
