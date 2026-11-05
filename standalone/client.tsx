import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('The Sudoku application container is missing.');
async function start() {
  try {
    const response = await fetch('/api/server-info', {cache:'no-store', signal:AbortSignal.timeout(5000)});
    if (response.ok) {
      const info = await response.json() as {shareOrigin?:string};
      if (typeof info.shareOrigin==='string') {
        const origin = new URL(info.shareOrigin);
        if (origin.protocol==='http:'||origin.protocol==='https:') {
          (window as unknown as {__SUDOKU_SHARE_ORIGIN__?:string}).__SUDOKU_SHARE_ORIGIN__ = origin.origin;
        }
      }
    }
  } catch {
    // The server console also lists the network address if this optional lookup fails.
  }
  createRoot(container!).render(<Home />);
}
void start();
