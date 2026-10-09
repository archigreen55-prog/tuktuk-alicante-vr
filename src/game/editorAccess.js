// Who gets the level editor (0.17.0): only the owner. There is no server, so this is "hidden", not "locked": the editor is not in any menu until the
// device has been opened once with the secret link  <game address>/?editor=<EDITOR_KEY>  (the flag is then kept in this browser; ?editor=off removes it).
// What a player who finds it can do: make levels that live only in his own browser; nothing reaches other players (levels get into the game only
// through the repository). To change the key: edit EDITOR_KEY below (and send the new link to yourself).
import { loadSetting, saveSetting } from '../settings.js';

export const EDITOR_KEY = 'redaktor-ae9';

export function editorEnabled(params) {
  const k = params.get('editor');
  if (k === EDITOR_KEY) saveSetting('editor', true);
  else if (k === 'off') saveSetting('editor', false);
  if (k !== null) {   // the key does not stay in the address bar
    try { const u = new URL(location.href); u.searchParams.delete('editor'); history.replaceState(history.state, '', u.toString()); } catch { /* ignore */ }
  }
  return loadSetting('editor', false) === true;
}
