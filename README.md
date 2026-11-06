# DeGolyer ES Sudoku Studio

A classroom Sudoku game with five levels (4×4, 6×6, and three 9×9 levels), unique puzzles, student profiles, saved games, power-ups, personal records, earned coins, awards, customizable block avatars, and teacher-managed prizes.

Play the [hosted online game](https://degolyer-sudoku-studio.armandoa.chatgpt.site), or use the [standalone Windows server](https://github.com/ArmandoA88/degolyer-sudoku/releases/latest) on your classroom network or through its built-in Cloudflare Tunnel.

## Standalone Windows server

Put the single `DeGolyer-Sudoku-Server.exe` in a writable folder and double-click it. It contains the complete game and Cloudflare Tunnel helper, starts the server, and creates a public HTTPS student link. No adjacent helper, launcher, Cloudflare account, domain, or Node.js installation is required. The server automatically extracts and verifies its bundled tunnel helper in `SudokuData/runtime` when it starts online mode. Use `DeGolyer-Sudoku-Server.exe --offline` for school-network play without internet access.

The teacher dashboard opens directly at `http://127.0.0.1:8787/teacher` on the server computer. No teacher password, setup code, or sign-in is required. On the first run, enter your classroom name and teacher name once; later visits open the saved dashboard and controls. Choose **Share classroom**, wait for the public HTTPS link, and copy it for students. Cloudflare forwards their browser requests to the game running on your computer. Keep the computer awake, its internet connection active, and the server running while students play. Teacher pages and controls are unavailable through student network links and the tunnel. Offline mode instead shares a link for devices on a network that can reach the server. The older `Start-Sudoku-Online.cmd` launcher remains compatible but is unnecessary for the single-file EXE.

Students type their name and exactly four-digit PIN to sign in. New students choose **First visit? New account** and create an account once using just those two fields; there is no repeat-PIN field. Returning students use the same account every time, even when the public link changes.

Quick Tunnel links are temporary and change when the tunnel restarts. A different link does not reset the classroom or its saved student accounts. A permanent hostname requires a separate named-tunnel setup with a Cloudflare account and domain; that setup is not automated by this EXE. If the tunnel cannot connect, **Share classroom** shows its status and a separately labeled same-network fallback instead of treating that fallback as a public link. See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) for the service's temporary-use limits.

The local server saves profiles, puzzles, scores, coins, prizes, awards, block avatars, accessories, and upgrades in `SudokuData/classroom.sqlite` beside the EXE in both modes. These return when the server restarts and the student signs in with the same name and PIN. Stop it before backing up or moving the complete data folder. The separately hosted Site uses its own database.

To prepare a later update while the classroom is playing, build a separate `DeGolyer-Sudoku-Server-Update.exe` using `--output-name` as described in the build instructions. The running EXE keeps its embedded version. Activate the update after the session by stopping the previous server and running the new EXE from the same folder, where it opens the existing `SudokuData` classroom. Run only one server against that classroom at a time.

See [server instructions](SERVER-INSTRUCTIONS.txt), [build instructions](standalone/BUILD.md), and [runtime architecture](standalone/README-runtime.md).

## Hosted classroom setup

1. Open the hosted Site and choose **Set up my classroom**. The teacher signs in through ChatGPT. The first classroom belongs to that signed-in account.
2. Share the game link so new students can choose **First visit? New account**, enter a first name or nickname, and choose an exactly four-digit PIN. Creating an account requires only those two fields. Students create an account once, then sign in to that same account every time. You can also add names and PINs yourself in **Teacher dashboard**. The app does not display stored PINs.
3. Choose **Share classroom** and copy the classroom link. Share it through your school LMS, a message, or a bookmark on classroom devices. It works on school Wi-Fi and other internet-connected networks, without keeping the teacher's computer running. Students open the link, type their name, and enter their four-digit PIN; they do not need a ChatGPT account. The teacher dashboard still requires the teacher's ChatGPT account.
4. Customize each student's starting level, daily goal, avatar, and color theme. Adjust the classroom name, power-ups, leaderboard, and prize catalog in teacher settings.
5. Students sign in, choose a puzzle, and play. Boards, notes, scores, coins, awards, and avatar changes automatically save to the shared database after each successful action. Typing the same name and entering its PIN restores that student's saved game, records, rewards, and customizations on another device. A help button sends a visible request to the teacher.

There is one classroom, so no classroom code is required. Students type their name and four-digit PIN before opening their saved stats or boards. Name matching ignores capitalization and extra spaces. Profiles use a permanent student ID, so a teacher can edit a name without erasing records. New duplicate names are blocked; use a last initial or unique classroom nickname when needed. Only the last sign-in name is remembered on the device; PINs and real student progress are not stored in browser local storage.

The hosted version needs an internet connection. Check the save indicator before changing devices; if a change fails to save, use the offered retry or refresh action.

The game starts with an empty classroom. Create the teacher classroom once before the first lesson. Students can then create their own accounts without being pre-added by the teacher. Registration signs them in automatically, and new profiles start with zero records and coins. If sign-in cannot find a name, it offers explicit new-account creation and explains that a new account starts fresh. An incorrect PIN for an existing name asks the student to try again or get a teacher reset so they keep their saved progress. An existing name cannot be claimed or overwritten through registration. The teacher can turn **Allow students to create accounts** off after everyone has joined; existing accounts can still sign in. The dashboard shows only saved classroom activity and records. Old sample progress stored by an earlier version is cleared automatically when that browser opens the updated game.

## School colors

The navy-led design uses teal and gray accents, following the [school's published colors](https://degolyer.dallasisd.org/our-school/general-information). The school mascot is the Dolphin. Students can choose Navy Blue, DeGolyer Teal, or Silver Gray accents within this palette.

## Teacher visibility

The dashboard refreshes periodically while open. It shows the last reported activity, current board, level, elapsed game time, mistakes, and help requests. Activity reflects interactions inside this Sudoku game; it does not monitor the student's screen or other apps. Student presence is approximate and depends on an open, connected game tab. A teacher can review a board, send a coaching note, resolve help requests, export scores as CSV, and approve or mark prizes delivered.

## Records and rewards

Completed Mini puzzles earn exactly **1 coin**, including mistake-free finishes. Other levels earn their usual base coins plus 10 for a mistake-free finish: Explorer 35–45, Challenger 55–65, Expert 80–90, and Master 110–120. The level buttons show these rewards. Hints, scans, and time freezes are limited per puzzle and can be disabled by the teacher. Assisted results are identified separately. Personal bests use unassisted completed games. Prizes are classroom rewards, not money; a redemption spends game coins and waits for teacher approval or delivery.

Each student also has a block buddy they can edit with colors and faces, dress with earned accessories, and upgrade using game coins. Puzzle milestones earn permanent awards. The block buddy's appearance, owned accessories, upgrade level, and awards stay saved to the student's account alongside classroom prizes and scores.

The accessory shop now has 15 items priced from 100 to 2,500 coins, including hats, headphones, space gear, and special effects. Students can filter all items, owned items, or unowned items they can afford. Previously owned accessories remain owned and can be equipped without paying again. Teacher-managed classroom prize prices are unchanged.

## Development

Node 22.13+ and npm are required. Install dependencies with the Sites plugin's `install-dependencies.mjs` helper, run `npm run dev`, and build with the Sites `build-site.mjs` helper. The Vinext starter provides ChatGPT identity, a Cloudflare Worker, and a D1 binding named `DB`. Production and preview databases are separate.

The checked-in hosting manifest identifies the original deployed Site. To deploy your own copy with Sites, create a new Site and replace that project ID with your own; Site access permissions are enforced independently of this public source repository. Runtime secrets, student databases, and test output are excluded from Git.

Schema changes live in `db/schema.ts`; run `npm run db:generate` and commit generated migrations. Apply local migrations using Wrangler as described in the supplied Sites starter documentation. Production migrations are applied by the Sites deployment workflow.

Student PINs and session tokens are hashed server-side. Solutions and credential hashes stay on the server. Hosted teacher writes are authorized using the signed-in teacher account. The hosted `CLASSROOM_TEACHER_EMAIL` setting limits initial classroom setup to the Site owner's account; after setup, the stable Site user ID owns the classroom. In the standalone EXE, only the local `/teacher` dashboard and its local teacher API receive teacher access; the student API remains separate. Game records, completion rewards, and prize spending are validated on the server.
