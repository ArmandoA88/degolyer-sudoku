# Standalone Windows build

The standalone file is `DeGolyer-Sudoku-Server.exe` in the workspace root. It embeds Node.js, SQLite, the server/API, the complete browser game, database migrations, Cloudflare Tunnel, pinned helper metadata, and third-party license notices. Copying this single EXE is sufficient; installed users need no Node.js installation, npm, package install, launcher, or adjacent `cloudflared.exe`. Its writable classroom database is created separately in `SudokuData` beside the EXE.

Double-clicking the EXE starts the game and its public HTTPS tunnel. The bundled official `cloudflared` binary is extracted automatically into `SudokuData/runtime` and verified against the embedded SHA-256 metadata before execution; valid cached bytes can be reused. Online play requires internet while running. `--offline` skips tunnel startup and extraction for local network play without internet. Quick Tunnel mode needs no Cloudflare credentials or domain, and its temporary URL changes on each new tunnel. Named tunnels and permanent hostnames require separate account/domain setup and are not configured by this build. The older online launcher remains compatible but is unnecessary.

To rebuild from source on Windows x64:

1. Use Windows x64 Node.js 24 and the project's existing dependencies.
2. Install `postject` in the workspace `.tooling/sea-tools` directory. This build tool is not needed by the finished EXE.
3. Run `node standalone/download-cloudflared.mjs` from the project directory to obtain the build input. It downloads the official Windows x64 `cloudflared` version 2026.10.7 pinned in `standalone/cloudflared-release.json`, verifies its SHA-256 checksum, and places the binary and license in the workspace root. This step does not start a public tunnel. Node is needed for this build step only, not on the finished server computer.
4. Run `node standalone/build.mjs` from the project directory. The script bundles the React client, replaces cloud bindings with local adapters, embeds the verified helper and its metadata/license with the web assets and migrations, creates the Node SEA blob, injects it into a fresh copy of Node, and copies the result to the workspace root. Distribute only the finished server EXE; it contains its tunnel runtime and license notices.

`SUDOKU_NODE_BINARY` may point to the Node binary to embed. `SUDOKU_POSTJECT_CLI` may point to Postject's `dist/cli.js`. `node standalone/build.mjs --web-only` prepares embedded web assets and migration manifests without building the EXE.

To prepare an update while the classroom is playing, run `node standalone/build.mjs --output-name DeGolyer-Sudoku-Server-Update.exe`. This writes a separate single-file EXE in the workspace root and leaves the running server executable and student session untouched. Test the update using isolated fixture data. Launch the update for the next classroom session; it uses the same `SudokuData` folder beside it. Code and shop changes are not loaded into an already-running EXE.

Generated build output, the preparation blob, asset/migration manifests, and `build-info.json` live in the ignored `outputs/standalone` folder. Build inputs do not include the live classroom database. The browser bundle loads its fonts/styles/scripts locally and reads the server's share-link status before displaying classroom links. Share classroom updates when the requested public tunnel connects or fails, and local mode uses the LAN origin.

Build-time adapters use the same Sudoku API and record logic with local SQLite. The standalone `/teacher` page opens the dashboard and controls directly on the server computer, with no password, setup code, or teacher session. Its `/teacher/api/game` route receives local teacher identity; the ordinary student API does not. Teacher pages and APIs are unavailable through LAN student connections and the public tunnel. First-time setup asks for the classroom name and teacher name once, while existing classrooms and student records remain saved.

Packaging follows the [Node.js 24 single-executable documentation](https://nodejs.org/download/release/v24.18.0/docs/api/single-executable-applications.html). Third-party notices are embedded and available at `/licenses.txt` on the running server.
