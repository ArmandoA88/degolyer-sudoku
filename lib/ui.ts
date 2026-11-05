import { LEVELS } from './sudoku';

export const AVATARS = ['🐬', '🦊', '🐼', '🐸', '🦁', '🐨', '🐰', '🦉', '🐱'];
export const THEMES = ['navy', 'teal', 'silver'];
export const themeName = (theme: string) => ({ navy: 'Navy Blue', teal: 'DeGolyer Teal', silver: 'Silver Gray' }[theme] || 'Navy Blue');
export const levelName = (id: string) => LEVELS.find(level => level.id === id)?.name || id;
export const timeText = (seconds: number) => {
  const value = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
};

/** Remove only the retired browser-local sample classroom; real records live on the server. */
export function clearLegacyDemoStorage(storage: { removeItem(key: string): void }) {
  storage.removeItem('degolyer-sudoku-demo-v1');
}
