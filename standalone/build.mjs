import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(sourceDir);
const workspaceDir = path.dirname(projectDir);
const outputDir = path.join(projectDir, 'outputs', 'standalone');
const webDir = path.join(outputDir, 'web');
const executableName = 'DeGolyer-Sudoku-Server.exe';
const nodeExecutable = process.env.SUDOKU_NODE_BINARY || process.execPath;
const postjectCli = process.env.SUDOKU_POSTJECT_CLI || path.join(workspaceDir, '.tooling', 'sea-tools', 'node_modules', 'postject', 'dist', 'cli.js');
const finalExecutable = path.join(workspaceDir, executableName);
const packagedExecutable = path.join(outputDir, executableName);
const webOnly = process.argv.includes('--web-only');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build this Windows x64 executable using Windows x64 Node.js.');
}
if (!existsSync(postjectCli)) {
  throw new Error('Postject is missing. Install postject in the workspace .tooling/sea-tools directory, or set SUDOKU_POSTJECT_CLI to its dist/cli.js.');
}
if (!webOnly&&!existsSync(path.join(sourceDir, 'server.ts'))) {
  throw new Error('The standalone server entrypoint has not been created yet.');
}
await mkdir(webDir, {recursive:true});

const offlineBrowserPlugin = {
  name:'standalone-offline-client',
  setup(builder) {
    builder.onLoad({filter:/app[\\/]globals\.css$/}, async ({path:file}) => {
      let css = await readFile(file, 'utf8');
      css = css.replace(/^@import\s+url\(['"]https:\/\/fonts\.googleapis\.com[^\r\n]+?\);\r?\n?/m, '');
      css = css.replace(/^@import\s+["']tailwindcss["'];\r?\n?/m, '');
      css = css.replaceAll("'DM Sans'", 'Arial').replaceAll('Manrope', 'Arial');
      return {contents:css, loader:'css', resolveDir:path.dirname(file)};
    });
    builder.onLoad({filter:/app[\\/]page\.tsx$/}, async ({path:file}) => {
      let code = await readFile(file, 'utf8');
      const replacements = [
        ['/signin-with-chatgpt?return_to=/', '/teacher'],
        ['One classroom link connects your students to their own saved game on any device with internet access.', 'One classroom link connects students to their saved game on this school network while the classroom server is running.'],
        ['Students open it on school Wi-Fi or another internet connection. A browser is all they need.', 'Students open it on the same school Wi-Fi or wired network as the server. A browser is all they need.'],
        ['Students do not need a ChatGPT account. Your teacher dashboard still requires your teacher sign-in. Add student names before sharing the link.', 'Students use their name and PIN. Open the teacher dashboard on the server computer using its local teacher password. Add student names before sharing the link.'],
        ['No student ChatGPT account is needed.', 'No student account outside this classroom is needed.'],
        ['Students use their classroom code and private PIN. No student ChatGPT account is needed.', 'Students use their classroom code and private PIN on the same network as this server.'],
        ['Teacher access uses your signed-in account. Sign in first to create and protect your classroom dashboard.', 'Teacher access uses the password created on this server computer. Sign in locally to create and protect your classroom dashboard.'],
        ['Sign in to set up', 'Teacher sign in'],
      ];
      for (const [from,to] of replacements) code = code.replaceAll(from,to);
      code = code.replaceAll("window.location.origin+'/?class='", "((window as any).__SUDOKU_SHARE_ORIGIN__||window.location.origin)+'/?class='");
      return {contents:code, loader:'tsx', resolveDir:path.dirname(file)};
    });
  },
};

await build({
  absWorkingDir:projectDir,
  entryPoints:[path.join(sourceDir,'client.tsx')],
  outfile:path.join(webDir,'assets','app.js'),
  bundle:true,
  minify:true,
  platform:'browser',
  target:['chrome110','edge110','firefox110'],
  format:'esm',
  jsx:'automatic',
  define:{'process.env.NODE_ENV':'"production"'},
  plugins:[offlineBrowserPlugin],
  logLevel:'info',
  legalComments:'linked',
});
await copyFile(path.join(sourceDir,'index.html'),path.join(webDir,'index.html'));
await copyFile(path.join(projectDir,'public','favicon.svg'),path.join(webDir,'favicon.svg'));

const licenses = [
  ['Node.js runtime', path.join(path.dirname(nodeExecutable),'LICENSE')],
  ['React', path.join(projectDir,'node_modules','react','LICENSE')],
  ['React DOM', path.join(projectDir,'node_modules','react-dom','LICENSE')],
  ['Lucide React', path.join(projectDir,'node_modules','lucide-react','LICENSE')],
];
let notices = 'DeGolyer ES Sudoku Studio — bundled third-party software notices\n\n';
for (const [name, file] of licenses) {
  if (!existsSync(file)) throw new Error(`Required license is missing: ${name}`);
  notices += `${name}\n${'='.repeat(name.length)}\n${await readFile(file,'utf8')}\n\n`;
}
await writeFile(path.join(webDir,'licenses.txt'),notices);

const mimeTypes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
const assets = {};
async function collect(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const file = path.join(directory,entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (entry.isFile()) {
      const key = '/'+path.relative(webDir,file).replaceAll('\\','/');
      assets[key] = {content:(await readFile(file)).toString('base64'),mime:mimeTypes[path.extname(file)]||'application/octet-stream'};
    }
  }
}
await collect(webDir);
if (Object.values(assets).some(a=>a.mime.startsWith('text/css')&&Buffer.from(a.content,'base64').toString('utf8').includes('@import'))) {
  throw new Error('An external stylesheet dependency remains in the offline web bundle.');
}
const assetsFile = path.join(outputDir,'web-assets.json');
await writeFile(assetsFile,JSON.stringify(assets));
const migrations = [];
for (const name of (await readdir(path.join(projectDir,'drizzle'))).filter(name=>name.endsWith('.sql')).sort()) {
  migrations.push({name,sql:await readFile(path.join(projectDir,'drizzle',name),'utf8')});
}
const migrationsFile = path.join(outputDir,'migrations.json');
await writeFile(migrationsFile,JSON.stringify(migrations));
if (webOnly) {
  console.log(JSON.stringify({webAssets:assetsFile,migrations:migrationsFile,assetCount:Object.keys(assets).length},null,2));
  process.exit(0);
}

const bundledServer = path.join(outputDir,'server.cjs');
const serverBuild = await build({
  absWorkingDir:projectDir,
  entryPoints:[path.join(sourceDir,'server.ts')],
  outfile:bundledServer,
  bundle:true,
  platform:'node',
  target:'node24',
  format:'cjs',
  metafile:true,
  logLevel:'info',
  plugins:[{
    name:'standalone-server-bindings',
    setup(builder) {
      builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:path.join(sourceDir,'cloudflare.ts')}));
      builder.onResolve({filter:/chatgpt-auth(?:\.ts)?$/},args=>{
        const candidate = path.resolve(args.resolveDir,args.path).replace(/\.ts$/,'');
        if (candidate===path.join(projectDir,'app','chatgpt-auth')) return {path:path.join(sourceDir,'auth.ts')};
      });
    },
  }],
});
const builtins = new Set(builtinModules.flatMap(name=>[name,'node:'+name]));
for (const output of Object.values(serverBuild.metafile.outputs)) {
  for (const imported of output.imports) if (imported.external&&!builtins.has(imported.path)) throw new Error('The standalone server still needs an external dependency: '+imported.path);
}
await writeFile(path.join(outputDir,'server-metafile.json'),JSON.stringify(serverBuild.metafile,null,2));

const config = {
  main:bundledServer,
  output:path.join(outputDir,'sea-prep.blob'),
  disableExperimentalSEAWarning:true,
  useSnapshot:false,
  useCodeCache:false,
  execArgv:['--disable-warning=ExperimentalWarning'],
  execArgvExtension:'none',
  assets:{'web-assets.json':assetsFile,'migrations.json':migrationsFile},
};
const configFile = path.join(outputDir,'sea-config.json');
await writeFile(configFile,JSON.stringify(config,null,2));
function run(executable,args) {
  const result = spawnSync(executable,args,{cwd:projectDir,stdio:'inherit',windowsHide:true});
  if (result.error) throw result.error;
  if (result.status!==0) throw new Error('Build command failed with exit code '+result.status);
}
run(nodeExecutable,['--experimental-sea-config',configFile]);
await copyFile(nodeExecutable,packagedExecutable);
run(nodeExecutable,[postjectCli,packagedExecutable,'NODE_SEA_BLOB',config.output,'--sentinel-fuse','NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);
await copyFile(packagedExecutable,finalExecutable);
const exeBytes = await readFile(finalExecutable);
const details = {executable:finalExecutable,size:exeBytes.length,sha256:createHash('sha256').update(exeBytes).digest('hex'),node:process.version,assetCount:Object.keys(assets).length};
await writeFile(path.join(outputDir,'build-info.json'),JSON.stringify(details,null,2));
console.log(JSON.stringify(details,null,2));
