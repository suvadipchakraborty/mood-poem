# Mood Poem

An emotional compass pointing to classic literature. Pick a mood or the weather, and Mood Poem fetches a matching classic poem from the open [PoetryDB API](https://poetrydb.org/) and sets it on a shareable card.

Zero build step. Vanilla HTML, CSS and ES6+ JavaScript. No API keys.

## Structure

```text
├── index.html          App shell, meta + Open Graph tags
├── styles.css          "Modern Serene Typography" design
├── app.js              Matching engine, rendering, tabs, share, install
├── manifest.json       PWA manifest
├── sw.js               Service worker (app-shell caching)
├── preview.png         1200x630 social preview (og:image)
├── icons/              PWA + Apple touch icons
└── README.md
```

## How matching works

1. `MOOD_MAP` in `app.js` links every pill to one or more search keywords (for example Melancholy → `tears`, Rainy → `rain`).
2. The app calls `https://poetrydb.org/lines/{keyword}`.
3. From the returned array it picks one poem at random, preferring poems that contain the keyword as a real word and fit comfortably on a card. The poem you just saw is skipped on "Find another".
4. `title`, `author` and `lines` are rendered as stanzas (empty strings in `lines` become stanza breaks), with the matched word softly highlighted.

To add a mood, add one entry to `MOOD_MAP`. The grid builds itself.

## Deploy: GitHub → Cloudflare

1. Create a GitHub repo and drag every file and folder from this project into it (keep `index.html` at the repo root).
2. In Cloudflare, connect the repo.
   - **Pages:** framework preset `None`, build command empty, output directory `/`.
   - **Workers (static assets):** point the assets directory at the repo root.
3. Your site URL and `og:image` are already set to `https://mood-poem.suvadipchakraborty.workers.dev`. If the URL changes, update it in `index.html` (canonical, `og:*`, `twitter:image`) and `APP_URL` in `app.js`.

### Optional: keep the service worker fresh

Add a `_headers` file at the repo root so browsers always check for a new `sw.js`:

```text
/sw.js
  Cache-Control: no-cache
```

## Updating after launch

Bump `CACHE_VERSION` in `sw.js` (for example `mood-poem-v2`) whenever you change any file listed in `SHELL`, so installed apps pick up the update.

## Testing PWA install

- Service workers need HTTPS (or `localhost`). Run locally with `python3 -m http.server 8080` and open `http://localhost:8080`.
- Chrome / Edge / Android: the **Install app** button in the About tab triggers the native prompt.
- iPhone / iPad: Safari has no install prompt, so the button shows how to use Share → Add to Home Screen.

## Credits

Poems from the open-source PoetryDB API.
