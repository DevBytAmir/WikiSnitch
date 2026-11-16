# WikiSnitch website

The public page for WikiSnitch ([wikisnitch.lol](https://wikisnitch.lol)): a static site with the demo video.
No build step, no dependencies.

## Layout

```
index.html            the page
404.html              the not-found page
robots.txt            crawler rules
sitemap.xml           list of pages for search engines
_headers              response headers (security, caching)
assets/
  css/site.css        all styles, light and dark themes as tokens
  js/theme.js         light/dark switch, remembers the choice
  js/hero.js          the seal, moon and moving boxes (plain JavaScript, no libraries)
  img/                logo, favicon, social preview image (og-image.jpg), video poster, hero art
  video/demo.mp4      the demo, 1080p, about 23 MB
```

## Run it locally

```bash
python3 -m http.server 8090      # then open http://localhost:8090
```

The 404 page is shown by the web server for unknown paths; locally, open `/404.html`.

## Notes

- `assets/js/hero.js` is ported from the app's `SealMoon` component in the
  [main repository](https://github.com/DevBytAmir/WikiSnitch). Edit it directly here.
- To replace the demo video, keep it under about 24 MB:
  `ffmpeg -i source.mp4 -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart assets/video/demo.mp4`
- Text and edit history described on the page come from Wikipedia, CC BY-SA 4.0.
