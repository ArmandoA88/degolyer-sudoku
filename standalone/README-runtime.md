# Standalone runtime

The Windows SEA executable embeds the compiled browser app and migration SQL. It runs the same game API through two build aliases: `cloudflare:workers` becomes the local SQLite binding, and the hosted identity helper becomes an AsyncLocalStorage identity supplied by the local teacher session.

No OpenAI identity header is trusted. Teacher setup and sign-in require both a loopback socket and loopback hostname. First setup uses a random link printed only in the server window, then a teacher-created password. Passwords use salted scrypt hashes; teacher and student session tokens are stored as hashes. Teacher sessions work only on the server computer. Students use the network link, classroom code, name, and PIN.

`SudokuData/classroom.sqlite` lives beside the executable, with SQLite WAL and full synchronization enabled. The API's D1 batch calls run as synchronous SQLite transactions to preserve the game's `changes()` guards, exactly-once rewards, and coin balance checks. Schema migrations are tracked separately and applied transactionally. Stop the server before copying its data directory as a backup. The hosted Site and this local database are separate classrooms.

Runtime options: `--port 8787`, `--host 0.0.0.0`, `--data-dir PATH`, `--no-open`, `--help`, and `--version`. Developer runs outside SEA additionally need `--assets web-assets.json --migrations migrations.json`. The static asset manifest is a map from URL path to `{content: base64, mime: contentType}`. Migration assets are `{name,sql}[]`.

The server shows IPv4 classroom links. Students need access to the same network and the Windows host must permit the server's listening port. It serves only embedded web assets and the game's API; source code, database files, and arbitrary disk paths are never exposed. The network game does not require internet access once the executable is built.
