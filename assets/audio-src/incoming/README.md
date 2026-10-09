# Звуки, скачані вручну (09.10.2026)

Мережа хмарної сесії агента не пускала на freesound.org і kenney.nl, тому файли скачано з іншого середовища й покладено сюди.
Назви збігаються з тим, що чекає `tools/fetch-sounds.mjs` у `assets/audio-src/dl/`:

```
mkdir -p assets/audio-src/dl
cp assets/audio-src/incoming/*.mp3 assets/audio-src/incoming/*.zip assets/audio-src/dl/
for k in kenney-impact kenney-interface kenney-scifi kenney-voice; do unzip -q -o assets/audio-src/dl/$k.zip -d assets/audio-src/dl/$k; done
```

- `fsNNNNNN.mp3`: HQ-прев'ю з cdn.freesound.org (той самий файл, що бере fetch-sounds). Ліцензії перевірено на сторінках файлів 09.10.2026:
  CC0: 423990, 180005, 177754, 177577, 658928, 614627, 536769, 339132, 869026, 182474, 60013, 381275, 859265, 333405.
  CC BY 4.0: 27881 (Stickinthemud), 635383 (Marcy13).
- `kenney-*.zip`: пакети Kenney (CC0) як є: Impact Sounds, Interface Sounds, Sci-fi Sounds, Voiceover Pack.
  У Voiceover Pack вигуків радості («woohoo», сміх) нема: там «go», «ready», «congratulations», «you win», військові команди тощо.

Ця папка тимчасова: після перенесення в `dl/` її можна видалити з гілки.
