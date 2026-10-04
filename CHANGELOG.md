# redirects-file

## 0.2.0

- New `aliases` option (default `false`): also emit a 301 for every frontmatter `aliases` entry, pointing to the page. Relative aliases resolve against the page; aliases that are real pages or already explicit rules are skipped.

## 0.1.1

Bug fixes found in review:

- `to` can now be a full URL (`"https://example.com/new-page"`) to redirect to a different site; it was previously always prefixed with a stray `/`, mangling absolute destinations.
- `options.redirects` no longer crashes the build when a config explicitly sets it to `null`/`undefined` (e.g. an empty `redirects:` key in YAML) — it now falls back to the default empty list instead of letting the merge silently drop it.

## 0.1.0

Initial release.

- Catch-all pretty-URL rewrite (`catchAllRewrite`, default `true`).
- Explicit redirect rules (`redirects`), URL-encoded the way a browser actually sends a path.
