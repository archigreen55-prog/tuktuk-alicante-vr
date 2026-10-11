// The list of Crazy Tuk levels in a <select> (the title screen and the pause menu): the ordinary levels first, the hard ones (`group: "hard"` in
// data/levels/index.json: a climb, hairpins) folded behind one row "Hard ▾"; choosing it unfolds them, a hard level that is the current one shows them at once.
// rows: [[id, name, group]] (src/main.js levels()); returns [[value, text, disabled]] for a select.
import { t } from '../i18n.js';

export const levelFold = { expanded: false };
export const HARD_ROW = '__hard';
export function levelOptions(rows, current) {
  const plain = rows.filter(([, , g]) => g !== 'hard'), hard = rows.filter(([, , g]) => g === 'hard');
  const out = plain.map(([id, name]) => [id, name, false]);
  if (!hard.length) return out;
  if (levelFold.expanded || hard.some(([id]) => id === current)) out.push(['__hardHead', '— ' + t('lv.hard') + ' —', true], ...hard.map(([id, name]) => [id, name, false]));
  else out.push([HARD_ROW, t('lv.hard') + ' ▾', false]);
  return out;
}
// for a select that has just changed to the "Hard ▾" row: unfolds (the caller refills the options and may open the picker)
export const unfoldIfHardRow = (value) => { if (value === HARD_ROW) { levelFold.expanded = true; return true; } return false; };
