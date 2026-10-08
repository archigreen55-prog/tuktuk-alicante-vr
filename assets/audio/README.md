# assets/audio: звукові файли гри

Сюди кладе файли **тільки скрипт** `node tools/prepare-audio.mjs` (з `assets/audio-src/`); руками їх редагувати не треба.

Формат: AAC у `.m4a` (грає в усіх телефонних браузерах). Ефекти: моно ≈ 20–60 КБ; цикли: моно, безшовні; музика: стерео ≈ 96–128 кбіт/с.

## Слоти (`manifest.json`)

```json
{
  "sfx": {
    "hit.light": ["sfx/hit-light-1.m4a"], "hit.medium": ["..."], "hit.heavy": ["..."],
    "gate.exact": ["..."], "gate.good": ["..."], "gate.ok": ["..."],
    "nitro.start": ["..."], "horn": ["sfx/horn-1.m4a", "sfx/horn-2.m4a", "sfx/horn-3.m4a"],
    "nearmiss": ["..."], "drift.end": ["..."], "combo": ["..."], "landing": ["..."], "smash": ["..."],
    "tourist.cheer": ["..."], "tourist.laugh": ["..."], "tourist.scream": ["..."], "tourist.gasp": ["..."]
  },
  "loops": {
    "engine": { "file": "loops/engine.m4a", "kmh": [0, 150], "rate": [0.7, 1.9], "gain": [0.35, 0.7] },
    "wind":   { "file": "loops/wind.m4a",   "kmh": [50, 150], "gain": [0, 0.5] },
    "squeal": { "file": "loops/squeal.m4a", "slip": [2.5, 9], "gain": [0, 0.8] },
    "nitro":  { "file": "loops/nitro.m4a",  "gain": [0, 0.6] }
  },
  "music": { "menu": "music/menu.m4a", "drive": ["music/drive-1.m4a", "music/drive-2.m4a"] },
  "credits": ["Назва: автор, ліцензія, посилання"]
}
```

- Кілька файлів у списку: щоразу випадковий (не набридає).
- Двигун: тон (`rate`) і гучність (`gain`) ростуть із швидкістю (`kmh`); вітер: гучність росте від `kmh[0]`; вереск: від бокової швидкості (`slip`, м/с); нітро: поки горить.
- Слот без файлу просто мовчить; гра працює й з порожнім `manifest.json`.
- Музика: `menu` грає в меню, на відліку й у підсумку; `drive` під час їзди; треки переходять один в одного з плавним зведенням (3 с); пауза приглушує музику.

## Як додати звуки

1. Файли в `assets/audio-src/` (інструкція з телефона: `docs/sound-candidates.md`, розділ 4).
2. `assets/audio-src/map.json`: який файл у який слот, обрізка й гучність (приклад у `tools/prepare-audio.mjs`).
3. `node tools/prepare-audio.mjs`: конвертує в `assets/audio/`, вирівнює гучність, оновлює `manifest.json` і подяки.
