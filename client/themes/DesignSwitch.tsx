import { useState } from 'react';
import { getDesign, setDesign, type Design } from './design';
import { applyTheme } from './theme';

/** TEMPORARY: a small floating switch to flip between the original and the new design. See design.ts to remove it. */
export function DesignSwitch() {
  const [design, setState] = useState<Design>(getDesign());
  const choose = (d: Design) => {
    setDesign(d);
    applyTheme(); // Premium defaults to Dark when no theme was chosen, so re-resolve it
    window.dispatchEvent(new Event('georgie:design'));
    setState(d);
  };
  return (
    <div className="design-switch" role="group" aria-label="Design (temporary)">
      <span className="design-switch-label">Design</span>
      <button className={design === 'old' ? 'on' : ''} aria-pressed={design === 'old'} onClick={() => choose('old')}>
        Old
      </button>
      <button className={design === 'new' ? 'on' : ''} aria-pressed={design === 'new'} onClick={() => choose('new')}>
        New
      </button>
      <button className={design === 'premium' ? 'on' : ''} aria-pressed={design === 'premium'} onClick={() => choose('premium')}>
        Premium
      </button>
    </div>
  );
}
