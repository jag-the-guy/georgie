// Guards the colour system: every colour is a token, the new design defines the full token set in light AND dark, and
// every text/background pair meets WCAG AA. Part of the temporary design experiment (client/themes).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const styles = read('client/styles.css');
const redesign = read('client/themes/redesign.css');
const premium = read('client/themes/premium.css');

/** Body of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const i = css.indexOf(selector + ' {');
  if (i < 0) throw new Error('no block ' + selector);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}
function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const base = tokens(block(styles, ':root'));
const variants = (['new', 'premium'] as const).map((name) => {
  const css = name === 'new' ? redesign : premium;
  return {
    name,
    css,
    light: tokens(block(css, `:root[data-design='${name}']`)),
    dark: tokens(block(css, `:root[data-design='${name}'][data-theme='dark']`)),
  };
});
const COLOUR_TOKEN = /^--(color|rate|result|state|notice|folder|shadow)/;
const colourTokens = Object.keys(base).filter((k) => COLOUR_TOKEN.test(k));

describe('token coverage', () => {
  it('the original design defines every colour token it uses', () => {
    const used = new Set([...styles.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    for (const u of used) if (!u.startsWith('--c')) expect(base, u).toHaveProperty(u);
  });

  describe.each(variants)('$name design', ({ light, dark }) => {
    it('redefines every colour token, in light and in dark', () => {
      for (const k of colourTokens) {
        expect(light, `light ${k}`).toHaveProperty(k);
        expect(dark, `dark ${k}`).toHaveProperty(k);
      }
    });

    it('light and dark define exactly the same token names', () => {
      expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    });
  });
});

describe('no raw colours outside the token blocks', () => {
  const RAW = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
  // Token definitions (which may span several lines) are the one place raw colours are allowed.
  const offenders = (css: string) =>
    css
      .replace(/--[\w-]+\s*:[^;]*;/g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => RAW.test(l));

  it('styles.css only has raw colours as token values', () => {
    expect(offenders(styles.replace(block(styles, ':root'), ''))).toEqual([]);
  });
  it.each(variants)('$name design css only has raw colours as token values', ({ css }) => {
    expect(offenders(css)).toEqual([]);
  });
  it('components and pages use tokens, not raw colours', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(join(__dirname, '..', dir))) {
        const p = join(dir, f);
        if (statSync(join(__dirname, '..', p)).isDirectory()) {
          if (f !== 'themes') walk(p); // themes/ holds the neutral Old/New switch, which is intentionally fixed
        } else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk('client');
    for (const f of files) expect(offenders(read(f)), f).toEqual([]);
  });
});

// ---------- WCAG contrast ----------
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error('not an opaque hex colour: ' + hex);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const TEXT = 4.5; // body text
const UI = 3; // large text, icons, borders of controls
const FOLDERS = ['lavender', 'peach', 'sky', 'mint', 'rose', 'lemon'];
const pairs: [fg: string, bg: string, min: number][] = [
  // Body text on every surface
  ...['--color-bg', '--color-surface', '--color-surface-sunken', '--color-primary-soft', '--color-primary-wash'].map((bg) => ['--color-text', bg, TEXT] as [string, string, number]),
  ...['--color-bg', '--color-surface', '--color-surface-sunken'].flatMap((bg) => [
    ['--color-text-muted', bg, TEXT],
    ['--color-text-faint', bg, TEXT],
    ['--color-primary', bg, bg === '--color-surface-sunken' ? UI : TEXT], // links (text on the sunken tone uses primary-hover)
  ] as [string, string, number][]),
  ['--color-text-muted', '--color-primary-soft', TEXT],
  ['--color-text-disabled', '--color-surface', TEXT], // out-of-month calendar days
  ['--color-text-disabled', '--color-bg', TEXT],
  // Primary buttons and highlighted rows
  ['--color-on-primary', '--color-primary', TEXT],
  ['--color-on-primary-muted', '--color-primary', TEXT],
  ['--color-on-primary', '--color-primary-hover', TEXT],
  ['--color-on-primary', '--color-primary-light', UI], // large avatar initial on the gradient
  ['--color-primary-hover', '--color-primary-soft', TEXT], // secondary buttons, active nav
  ['--color-primary-hover', '--color-primary-soft-hover', TEXT],
  ['--color-primary-hover', '--color-surface-sunken', TEXT],
  ['--color-primary', '--color-surface', UI], // focus ring, progress, outlines
  ['--color-primary', '--color-bg', UI],
  // Real errors and destructive actions
  ['--color-error', '--color-surface', TEXT],
  ['--color-error', '--color-bg', TEXT],
  ['--color-error', '--color-error-soft', TEXT],
  ['--color-error', '--color-error-soft-hover', TEXT],
  // Gold accent
  ['--color-on-accent', '--color-accent', TEXT],
  ['--color-accent-text', '--color-accent-soft', TEXT],
  // Controls
  ['--color-border-dashed', '--color-surface', UI],
  ['--color-border-dashed', '--color-surface-sunken', UI],
  ['--color-border-tile-add', '--color-surface-sunken', UI],
  ['--color-border-dropzone', '--color-surface-sunken', UI],
  ['--color-switch-off', '--color-surface', UI],
  ['--color-switch-thumb', '--color-switch-off', UI],
  // Review ratings, typed-answer results, card states, notices
  ...[1, 2, 3, 4].flatMap((n) => [
    [`--rate-${n}-fg`, `--rate-${n}-bg`, TEXT],
    [`--rate-${n}-on-solid`, `--rate-${n}-solid`, TEXT],
    ['--color-text', `--rate-${n}-bg`, TEXT],
  ] as [string, string, number][]),
  ...['correct', 'almost', 'wrong'].map((r) => [`--result-${r}-fg`, `--result-${r}-bg`, TEXT] as [string, string, number]),
  ...['new', 'learning', 'review'].flatMap((s) => [
    [`--state-${s}-fg`, `--state-${s}-bg`, TEXT],
    [`--state-${s}-fg`, '--color-surface', s === 'review' ? UI : TEXT],
  ] as [string, string, number][]),
  ['--notice-warn-fg', '--notice-warn-bg', TEXT],
  // Folder tiles: card text on the tint, white/dark icon on the art colour, art colour against the page
  ...FOLDERS.flatMap((f) => [
    ['--color-text', `--folder-${f}-bg`, TEXT],
    ['--color-text-muted', `--folder-${f}-bg`, TEXT],
    ['--color-text-faint', `--folder-${f}-bg`, TEXT],
    ['--color-on-tile', `--folder-${f}`, UI],
    [`--folder-${f}`, '--color-surface', UI],
  ] as [string, string, number][]),
];

const modes = variants.flatMap((v) => [
  [`${v.name} light`, v.light],
  [`${v.name} dark`, v.dark],
] as const);
describe.each(modes)('WCAG AA contrast, %s mode', (_name, theme) => {
  it.each(pairs)('%s on %s needs %s:1', (fg, bg, min) => {
    expect(theme, fg).toHaveProperty(fg);
    expect(theme, bg).toHaveProperty(bg);
    const r = ratio(theme[fg], theme[bg]);
    expect(r, `${fg} ${theme[fg]} on ${bg} ${theme[bg]} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });
});

describe('feedback colours', () => {
  it('only real errors use red: no rating, result or state colour is in the red family', () => {
    const hue = (hex: string) => {
      const [r, g, b] = rgb(hex).map((v) => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const theme of variants.flatMap((v) => [v.light, v.dark])) {
      const keys = Object.keys(theme).filter((k) => /^--(rate|result|state)-.*-(fg|solid)$/.test(k) && !k.includes('on-solid'));
      for (const k of keys) {
        const h = hue(theme[k]);
        const isRed = h < 14 || h > 340; // coral/amber start at about 25 degrees
        expect(isRed, `${k} ${theme[k]} hue ${h.toFixed(0)}`).toBe(false);
      }
    }
  });
});

describe('premium gradients', () => {
  const premium = variants.find((v) => v.name === 'premium')!;
  it.each([
    ['light', premium.light],
    ['dark', premium.dark],
  ] as const)('button label stays AA on every stop of the %s primary gradient', (_n, theme) => {
    const stops = theme['--fx-primary-fill'].match(/#[0-9a-f]{6}/gi) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(3);
    for (const stop of stops) expect(ratio(theme['--color-on-primary'], stop), stop).toBeGreaterThanOrEqual(TEXT);
  });
});
