/**
 * TEMPORARY design experiment.
 *
 * Two looks live side by side: the original one (client/styles.css, untouched) and the experimental one
 * (client/themes/redesign.css, which only applies when <html data-design="new">). The switch in DesignSwitch.tsx flips
 * between them instantly, on every screen, and remembers the choice on this device.
 *
 * TO REMOVE THIS EXPERIMENT: delete the client/themes folder and the two lines marked "design experiment" in
 * client/main.tsx. The app then looks exactly like the original design again.
 */
export type Design = 'old' | 'new';
const KEY = 'georgie.design';

export function getDesign(): Design {
  try {
    return localStorage.getItem(KEY) === 'old' ? 'old' : 'new';
  } catch {
    return 'new';
  }
}

export function setDesign(design: Design) {
  document.documentElement.dataset.design = design;
  try {
    localStorage.setItem(KEY, design);
  } catch {
    /* private mode: just not remembered */
  }
}

// Applied the moment this file loads, before the first paint, so there is no flash of the other design.
document.documentElement.dataset.design = getDesign();
