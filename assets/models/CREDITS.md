# 3D-моделі пам'яток: автори й ліцензії

Беремо лише моделі з ліцензією CC BY, CC BY-SA, CC0 або власні скани. Моделі з NC (некомерційна) і ND (без змін) не беремо, бо гра може рекламувати тури. Моделі з ліцензією Sketchfab Standard теж не беремо: вона забороняє викладати файл у відкритий доступ.

Що змінено в кожній моделі (`tools/prepare-model.mjs`, налаштування в `data/facades.json` → `models`):
- сцену зведено в один меш, модель повернуто й масштабовано до реального розміру в метрах;
- трикутників менше (meshoptimizer), текстури зменшено до ≤ 2048 px і стиснено в KTX2 (Basis Universal);
- геометрію стиснено (meshopt).

У грі автор показаний у картці місця (Basílica de Santa María) на панелі й у картці на екрані.

| Файл у грі | Що це | Автор | Ліцензія | Оригінал |
|---|---|---|---|---|
| `santa-maria-portal.glb` | Портал (portada) базиліки Santa María, бароко, Juan Bautista Borja, скан | David González (@davidgf) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Portada Basilica Santa Maria](https://sketchfab.com/3d-models/portada-basilica-santa-maria-12d322a762e14c0db6ec2e00b0130dca), Sketchfab, 2019 |

Свій скан замість чужого: у записі моделі в `data/facades.json` поміняй `from` (твій GLB у `assets/models/src/`), `rotate` і `width`, прибери `credit` і запусти `node tools/prepare-model.mjs <id>`.
