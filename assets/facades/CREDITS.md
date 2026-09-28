# Фото фасадів: автори й ліцензії

Фото-фасади в грі зроблено з вільних фото Wikimedia Commons. Фото без вільної ліцензії (CC BY, CC BY-SA, CC0 / public domain) сюди не беремо.

Що змінено в кожному фото (`tools/prepare-facade.mjs`): виправлено перспективу за 4 кутами фасаду, обрізано по фасаду, зменшено (≤ 2048 px), стиснено в JPEG, небо прибрано маскою (`*.mask.png`). Налаштування (кути, контур, звідки фото) — у `data/facades.json`.

Змінені фото з ліцензією **CC BY-SA** поширюються на тих самих умовах (та сама версія CC BY-SA). Фото з **CC BY** — з указанням автора, як нижче. Ці ліцензії стосуються лише фото, не коду гри.

У грі автори показані в картці місця (Mercado Central) на панелі й у картці на екрані.

| Файл у грі | Що на ньому | Автор | Ліцензія | Оригінал |
|---|---|---|---|---|
| `mercado-front.jpg`, `mercado-front.mask.png` | Mercado Central, головний фасад (Avinguda Alfons el Savi), 2026 | Varondán | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Mercado Central de Alicante 03.jpg](https://commons.wikimedia.org/wiki/File:Mercado_Central_de_Alicante_03.jpg) |
| `mercado-rotunda.jpg`, `mercado-rotunda.mask.png` | ротонда з куполом на розі з Carrer del Capità Segarra, 2016 | Kolforn | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Central Market, Avinguda Alfons el Savi, Alicante, 16 July 2016.JPG](https://commons.wikimedia.org/wiki/File:Central_Market,_Avinguda_Alfons_el_Savi,_Alicante,_16_July_2016.JPG) |
| `mercado-back.jpg`, `mercado-back.mask.png` | задній фасад (Plaça del 25 de Maig), 2009 | Joanbanjo | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Mercat Central d'Alacant, façana posterior.JPG](https://commons.wikimedia.org/wiki/File:Mercat_Central_d%27Alacant,_fa%C3%A7ana_posterior.JPG) |
| `mercado-wall.jpg` | проліт бічної стіни (Carrer de Calderón de la Barca), повторюється вздовж боків, 2009 | Etnacila | public domain (автор передав у суспільне надбання) | [Alicante042009MercadoCentral.jpg](https://commons.wikimedia.org/wiki/File:Alicante042009MercadoCentral.jpg) |

Коли своє фото замінює фото з вікісховища: поміняй у `data/facades.json` поля `from`, `corners`, `outline` і `credit` (або прибери `credit`, якщо фото твоє), запусти `node tools/prepare-facade.mjs <id>` і онови цю таблицю.
