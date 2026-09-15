# redirects-file

Emits a Netlify-style `_redirects` file at the root of your build output, for hosts that support it (Netlify, Cloudflare Pages, Sevalla, ...). It does two things:

1. **A catch-all pretty-URL rewrite.** Some hosts' own "pretty URL" feature 30x-redirects an extensionless URL (`/foo`) to a trailing-slash URL (`/foo/`). Quartz computes CSS/JS `<link>`/`<script>` paths relative to the page being a _file_ (e.g. `../component-x.css`), so that redirect makes the browser treat the page as a directory one level deeper and breaks every relative asset path on it. This plugin's catch-all rule (`/* /:splat.html 200`) serves `foo.html` at `/foo` via a 200 rewrite instead, which keeps the URL -- and thus the relative-path depth -- unchanged.
2. **Your own explicit redirect rules**, e.g. for URLs that moved when you changed how slugs are generated, renamed a note, or restructured a folder.

It doesn't compute redirects for you from frontmatter or from a slug-generation change — for that, see [`alias-redirects`](https://github.com/quartz-community/alias-redirects) (frontmatter `aliases` + Quartz v4→v5 case-normalization redirects). This plugin is for redirects you declare explicitly, or that you compute yourself in `quartz.ts` and pass in as plugin options.

## Installation

```bash
npx quartz plugin add github:Shagshag/redirects-file
```

## Usage

```yaml title="quartz.config.yaml"
plugins:
  - source: github:Shagshag/redirects-file
    enabled: true
    options:
      redirects:
        - from: old-page
          to: new-page
        - from: temp-page
          to: other-page
          status: 302
```

`from` is a plain slug without a leading slash (e.g. `"développement/mon-article"`) — write it exactly as it'd appear in a URL, not pre-encoded. `to` can be a slug the same way, or a full URL (`"https://example.com/new-page"`) to redirect to a different site. The plugin URL-encodes both the way a browser actually sends a path (not `encodeURIComponent`, which over-escapes characters like `,` and `'` that are valid unencoded in a URL path and that browsers leave alone).

Rules are written to `_redirects` in the order given, ahead of the catch-all rewrite; matching is first-rule-wins, so put more specific rules before more general ones.

## Configuration

| Option            | Type             | Default | Description                                                                                   |
| ----------------- | ---------------- | ------- | --------------------------------------------------------------------------------------------- |
| `catchAllRewrite` | `boolean`        | `true`  | Emit the `/* /:splat.html 200` pretty-URL rewrite described above.                            |
| `redirects`       | `RedirectRule[]` | `[]`    | Explicit rules: `{ from: string, to: string, status?: number }` (`status` defaults to `301`). |

## Documentation

See the [Quartz documentation](https://quartz.jzhao.xyz) for general plugin configuration, and your host's docs for whether/how it supports a `_redirects` file (e.g. [Sevalla](https://docs.sevalla.com/static-sites/redirects), [Netlify](https://docs.netlify.com/routing/redirects/)).

## License

MIT
