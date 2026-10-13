/**
 * Light / dark / system theme.
 *
 * The saved choice ('light' | 'dark' | 'system', default 'system') lives in localStorage under georgie.theme. The page
 * always carries the RESOLVED theme in <html data-theme="light|dark">; the inline script in index.html sets it before the
 * first paint (so there is no flash), and this file keeps it in sync afterwards, including when the system setting changes.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'georgie.theme';

/** Nothing chosen yet: the design is built dark-first, so start in Dark ("System" is one click away). */
function defaultChoice(): ThemeChoice {
  return 'dark';
}

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : defaultChoice();
  } catch {
    return defaultChoice();
  }
}

function systemIsDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  document.documentElement.dataset.theme = choice === 'system' ? (systemIsDark() ? 'dark' : 'light') : choice;
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: just not remembered */
  }
  applyTheme(choice);
}

// Follow the system setting while the choice is "System".
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemeChoice() === 'system') applyTheme('system');
  });
}
applyTheme();
