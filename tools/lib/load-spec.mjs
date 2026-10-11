// data/tour.json with the data of TukTuk OS merged in (src/game/placesData.js): what the game has in `tourSpec` (Ukrainian; English in *_en)
import { readFile } from 'node:fs/promises';
import { mergePlaces } from '../../src/game/placesData.js';

const json = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
export async function loadSpec() {
  const spec = await json('data/tour.json', null);
  if (!spec) throw new Error('data/tour.json не читається');
  return mergePlaces(spec, await json('data/places-os.json', null), await json('data/places-os.en.json', null), await json('data/tuktuk-os-arcade.json', null));
}
