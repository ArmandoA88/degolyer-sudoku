# DeGolyer ES Sudoku Studio

A classroom Sudoku game with five levels (4×4, 6×6, and three 9×9 levels), unique puzzles, student profiles, saved games, power-ups, personal records, earned coins, and teacher-managed prizes.

## Classroom setup

1. Open the hosted Site and choose **Set up my classroom**. The teacher signs in through ChatGPT. The first classroom belongs to that signed-in account.
2. Open **Teacher dashboard**, create student profiles, and assign each student a code and PIN. Use classroom nicknames or first names. Save PINs when you create them; the app does not display stored PINs.
3. Give students the Site link, classroom code, their student code, and their PIN. The hosted game entry opens by link; students do not need a ChatGPT account. The teacher dashboard still requires the teacher's ChatGPT account.
4. Customize each student's starting level, daily goal, avatar, and color theme. Adjust the classroom name, power-ups, leaderboard, and prize catalog in teacher settings.
5. Students sign in, choose a puzzle, and play. Boards, notes, scores, and coins save to the shared database. A help button sends a visible request to the teacher.

The initial example classroom is clearly marked **Demo**. Its student activity is simulated and saved only on that device. Set up a real classroom to collect real student progress.

## Teacher visibility

The dashboard refreshes periodically while open. It shows the last reported activity, current board, level, elapsed game time, mistakes, and help requests. Activity reflects interactions inside this Sudoku game; it does not monitor the student's screen or other apps. Student presence is approximate and depends on an open, connected game tab. A teacher can review a board, send a coaching note, resolve help requests, export scores as CSV, and approve or mark prizes delivered.

## Records and rewards

Completed games earn game coins. Hints, scans, and time freezes are limited per puzzle and can be disabled by the teacher. Assisted results are identified separately. Personal bests use unassisted completed games. Prizes are classroom rewards, not money; a redemption spends game coins and waits for teacher approval or delivery.

## Development

Node 22.13+ and npm are required. Install dependencies with the Sites plugin's `install-dependencies.mjs` helper, run `npm run dev`, and build with the Sites `build-site.mjs` helper. The Vinext starter provides ChatGPT identity, a Cloudflare Worker, and a D1 binding named `DB`. Production and preview databases are separate.

Schema changes live in `db/schema.ts`; run `npm run db:generate` and commit generated migrations. Apply local migrations using Wrangler as described in the supplied Sites starter documentation. Production migrations are applied by the Sites deployment workflow.

PINs and session tokens are hashed server-side. Solutions and credential hashes stay on the server. Teacher writes are authorized using the signed-in teacher account. The hosted `CLASSROOM_TEACHER_EMAIL` setting limits initial classroom setup to the Site owner's account; after setup, the stable Site user ID owns the classroom. Game records, completion rewards, and prize spending are validated on the server.
