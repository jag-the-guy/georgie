import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from './theme';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** TEMPORARY: Light / System / Dark switch for the new design. Hidden while the Old design is selected. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice());
  useEffect(() => {
    const sync = () => setChoice(getThemeChoice());
    window.addEventListener('georgie:design', sync);
    return () => window.removeEventListener('georgie:design', sync);
  }, []);
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          className={choice === value ? 'on' : ''}
          onClick={() => {
            setThemeChoice(value);
            setChoice(value);
          }}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
