# SINCERITA (yarnpremium.com.ua)

Магазин пряжі на Next.js (Vercel). Каталог — знімок KeyCRM у Redis (`lib/catalog.ts`).

## Прев'ю посилань (Open Graph) — для кожної нової сторінки

Посилання на сайт кидають в Instagram, Telegram і Viber, і велика картка з фото виходить лише з повним набором тегів.

- Свої теги сторінка задає лише через `openGraph({ … })` з `lib/og.ts`, не `openGraph: { … }`. Next.js не доповнює спільні теги, а замінює їх, і без помічника зникають `og:type`, `og:site_name`, `og:locale` і картинка. `npm run build` перевіряє це сам (`scripts/check-og.mjs`) і не збереться.
- У кожної картинки прев'ю є ширина й висота: 1200×630, файл на нашому домені. Сховище KeyCRM забороняє роботів (robots.txt), тож його фото в `og:image` не ставити.
- Своя картинка для розділу — файл `opengraph-image.(png|jpg|tsx)` у його папці (як `app/product/[sku]/opengraph-image.tsx`), і тоді `openGraph({ … }, { ownImage: true })`. Картинка з `public/` — через `ogImage()`, він прочитає розміри.
- Після публікації перевірити посилання в Sharing Debugger Meta: https://developers.facebook.com/tools/debug/ («Scrape Again» оновлює те, що Instagram уже запам'ятав).
