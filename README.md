# DeGolyer ES Sudoku Studio

A classroom Sudoku game with five levels (4×4, 6×6, and three 9×9 levels), unique puzzles, student profiles, saved games, power-ups, personal records, earned coins, and teacher-managed prizes.

Play the [online game](https://degolyer-sudoku-studio.armandoa.chatgpt.site), or download the [standalone Windows server](https://github.com/ArmandoA88/degolyer-sudoku/releases/latest) for a classroom network without internet access.

## Standalone Windows server

Download `DeGolyer-Sudoku-Server.exe` from Releases, put it in a writable folder, and double-click it. Create the teacher password and classroom, add students, then choose **Share classroom**. Students on the same network pick their name and enter their PIN. No Node.js installation is needed to run the EXE.

The local server saves records in `SudokuData/classroom.sqlite` beside the EXE. Keep the server running while students play. Stop it before backing up or moving the complete data folder. The local and hosted editions use separate databases.

See [server instructions](SERVER-INSTRUCTIONS.txt), [build instructions](standalone/BUILD.md), and [runtime architecture](standalone/README-runtime.md).

## Classroom setup

1. Open the hosted Site and choose **Set up my classroom**. The teacher signs in through ChatGPT. The first classroom belongs to that signed-in account.
2. Open **Teacher dashboard**, create student profiles, and assign each student a code and PIN. Use classroom nicknames or first names. Save PINs when you create them; the app does not display stored PINs.
3. Choose **Share classroom** and copy the classroom link. Share it through your school LMS, a message, or a bookmark on classroom devices. It works on school Wi-Fi and other internet-connected networks, without keeping the teacher's computer running. Students open the link, pick their name, and enter their PIN; they do not need a ChatGPT account. The teacher dashboard still requires the teacher's ChatGPT account.
4. Customize each student's starting level, daily goal, avatar, and color theme. Adjust the classroom name, power-ups, leaderboard, and prize catalog in teacher settings.
5. Students sign in, choose a puzzle, and play. Boards, notes, scores, and coins automatically save to the shared database after each successful action. Picking the same name and entering its PIN restores that student's saved game, records, rewards, and customizations on another device. A help button sends a visible request to the teacher.

The classroom code loads only the names and avatars needed for the name picker. A student's PIN is required before their saved stats or board can be read or changed. Profiles use a permanent student ID, so editing a name does not erase records or combine students who share a name. Use initials or unique classroom nicknames to help students distinguish their names. Only the classroom code and last selected student ID are remembered on the device; PINs and real student progress are not stored in browser local storage.

The hosted version needs an internet connection. Check the save indicator before changing devices; if a change fails to save, use the offered retry or refresh action.

The game starts with an empty classroom. Create the teacher classroom and add student names and PINs before the first lesson. The dashboard shows only saved classroom activity and records. Old sample progress stored by an earlier version is cleared automatically when that browser opens the updated game.

## School colors

The navy-led design uses teal and gray accents, following the [school's published colors](https://degolyer.dallasisd.org/our-school/general-information). The school mascot is the Dolphin. Students can choose Navy Blue, DeGolyer Teal, or Silver Gray accents within this palette.

## Teacher visibility

The dashboard refreshes periodically while open. It shows the last reported activity, current board, level, elapsed game time, mistakes, and help requests. Activity reflects interactions inside this Sudoku game; it does not monitor the student's screen or other apps. Student presence is approximate and depends on an open, connected game tab. A teacher can review a board, send a coaching note, resolve help requests, export scores as CSV, and approve or mark prizes delivered.

## Records and rewards

Completed games earn game coins. Hints, scans, and time freezes are limited per puzzle and can be disabled by the teacher. Assisted results are identified separately. Personal bests use unassisted completed games. Prizes are classroom rewards, not money; a redemption spends game coins and waits for teacher approval or delivery.

## Development

Node 22.13+ and npm are required. Install dependencies with the Sites plugin's `install-dependencies.mjs` helper, run `npm run dev`, and build with the Sites `build-site.mjs` helper. The Vinext starter provides ChatGPT identity, a Cloudflare Worker, and a D1 binding named `DB`. Production and preview databases are separate.

The checked-in hosting manifest identifies the original deployed Site. To deploy your own copy with Sites, create a new Site and replace that project ID with your own; Site access permissions are enforced independently of this public source repository. Runtime secrets, student databases, and test output are excluded from Git.

Schema changes live in `db/schema.ts`; run `npm run db:generate` and commit generated migrations. Apply local migrations using Wrangler as described in the supplied Sites starter documentation. Production migrations are applied by the Sites deployment workflow.

PINs and session tokens are hashed server-side. Solutions and credential hashes stay on the server. Teacher writes are authorized using the signed-in teacher account. The hosted `CLASSROOM_TEACHER_EMAIL` setting limits initial classroom setup to the Site owner's account; after setup, the stable Site user ID owns the classroom. Game records, completion rewards, and prize spending are validated on the server.
