import fs from "node:fs/promises";
import path from "node:path";
import type {
  QuartzEmitterPlugin,
  BuildCtx,
  FilePath,
  ProcessedContent,
} from "@quartz-community/types";
import { joinSegments } from "@quartz-community/types";

export interface RedirectRule {
  /** Slug (no leading slash) of the URL to redirect FROM. */
  from: string;
  /**
   * Slug (no leading slash) of the URL to redirect TO, or a full URL
   * (e.g. `"https://example.com/new-page"`) to redirect to a different site.
   */
  to: string;
  /** HTTP status code. @default 301 */
  status?: number;
}

interface Options {
  /**
   * Emit a catch-all rewrite so extensionless "pretty" URLs (e.g. `/foo`)
   * serve `foo.html` via a 200 rewrite instead of a redirect.
   *
   * Several hosts' own "pretty URL" feature instead 30x-redirects to a
   * trailing-slash URL (`/foo/`), which breaks Quartz's file-relative asset
   * paths: Quartz computes `<link>`/`<script>` paths relative to the page
   * being a *file* (e.g. `../component-x.css`), and a redirect to a
   * trailing-slash URL makes the browser treat the page as a directory one
   * level deeper, breaking every relative asset path on that page. A 200
   * rewrite keeps the URL -- and thus the relative-path depth -- unchanged.
   *
   * @default true
   */
  catchAllRewrite: boolean;

  /**
   * Explicit redirect rules to emit ahead of the catch-all -- e.g. for URLs
   * that moved because you changed how slugs are generated, renamed a note,
   * or restructured a folder. Rules are written in the order given, and
   * matching is first-rule-wins (Netlify `_redirects` semantics), so put
   * more specific rules before more general ones.
   *
   * `from`/`to` are URL-encoded automatically -- write them as plain slugs
   * (e.g. `"développement/mon-article"`), not pre-encoded.
   *
   * @default []
   */
  redirects: RedirectRule[];

  /**
   * Also emit a redirect for every entry of a page's frontmatter `aliases`,
   * pointing to that page. Written after the explicit `redirects` and before
   * the catch-all. An alias that equals the slug of a real page, or that is
   * already the `from` of an explicit rule, is skipped.
   *
   * Aliases are only collected during a full build: in `--serve` incremental
   * rebuilds the file is not rewritten, so restart the build to see changes.
   *
   * @default false
   */
  aliases: boolean;
}

const defaultOptions: Options = {
  catchAllRewrite: true,
  redirects: [],
  aliases: false,
};

/**
 * Most Netlify-`_redirects`-compatible hosts (Sevalla included -- see
 * https://docs.sevalla.com/static-sites/redirects) require both columns to
 * be URL-encoded, and match against the *encoded* request path as sent by
 * the browser, not the decoded one.
 *
 * Plain `encodeURIComponent` over-escapes for this: it also encodes
 * characters like `,` and `'` that browsers themselves leave literal in a
 * path (they're valid sub-delimiters there per RFC 3986), so a rule built
 * with it would never match a real request. `encodeURI` mirrors what a
 * browser actually sends.
 */
function encodePath(slug: string): string {
  return encodeURI(slug.replace(/^\/+/, ""));
}

/**
 * A redirect `to` may be a full URL (`isAbsoluteTarget`), not just a path on
 * this site -- Netlify-style _redirects supports redirecting to a different
 * host. Those must be encoded and used as-is, without the leading `/` that
 * `from` (always a local path) and a local `to` both need.
 */
function isAbsoluteTarget(target: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target) || target.startsWith("//");
}

function formatFrom(from: string): string {
  return `/${encodePath(from)}`;
}

function formatTo(to: string): string {
  return isAbsoluteTarget(to) ? encodeURI(to) : `/${encodePath(to)}`;
}

function redirectsFileContents(options: Options, aliasRules: RedirectRule[] = []): string {
  const specificRules = [...options.redirects, ...aliasRules].map(
    (rule) => `${formatFrom(rule.from)} ${formatTo(rule.to)} ${rule.status ?? 301}`,
  );
  const lines = [...specificRules];
  if (options.catchAllRewrite) {
    lines.push("/*  /:splat.html  200");
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

/** Folder index pages live at the folder URL: `home/index` -> `home/`, `index` -> ``. */
function canonicalPath(slug: string): string {
  const segments = slug.split("/");
  if (segments[segments.length - 1] !== "index") return slug;
  segments.pop();
  return segments.length > 0 ? segments.join("/") + "/" : "";
}

function isRelative(alias: string): boolean {
  return alias.startsWith("./") || alias.startsWith("../");
}

/**
 * Turns frontmatter `aliases` into redirect rules. Relative aliases (`./x`,
 * `../x`) resolve against the page's own slug, like the alias-redirects plugin.
 */
function collectAliasRules(content: ProcessedContent[], explicit: RedirectRule[]): RedirectRule[] {
  const pageSlugs = new Set<string>();
  for (const [, file] of content) {
    const slug = file.data.slug as string | undefined;
    if (slug) pageSlugs.add(slug);
  }
  const taken = new Set(explicit.map((rule) => rule.from.replace(/^\/+/, "")));
  const rules: RedirectRule[] = [];

  for (const [, file] of content) {
    const slug = file.data.slug as string | undefined;
    const aliases = (file.data as Record<string, unknown>).aliases;
    if (!slug || !Array.isArray(aliases)) continue;

    const to = canonicalPath(slug);
    for (const alias of aliases) {
      if (typeof alias !== "string") continue;
      const from = (
        isRelative(alias) ? path.posix.normalize(path.posix.join(slug, "..", alias)) : alias
      ).replace(/^\/+|\/+$/g, "");
      if (!from || pageSlugs.has(from) || taken.has(from)) continue;
      taken.add(from);
      rules.push({ from, to });
    }
  }
  return rules;
}

/**
 * Emits a Netlify-compatible `_redirects` file at the root of the output
 * directory, for hosts that support it (Netlify, Cloudflare Pages, Sevalla,
 * ...). See the `Options` fields above for what it can do.
 */
export const RedirectsFile: QuartzEmitterPlugin<Partial<Options>> = (opts) => {
  // Field-by-field, not `{ ...defaultOptions, ...opts }`: plugin options
  // come from YAML, unchecked at runtime, so an explicit `redirects: null`/
  // empty key in quartz.config.yaml must fall back to the default array
  // rather than overwrite it and crash `.map()` below.
  const options: Options = {
    catchAllRewrite: opts?.catchAllRewrite ?? defaultOptions.catchAllRewrite,
    redirects: opts?.redirects ?? defaultOptions.redirects,
    aliases: opts?.aliases ?? defaultOptions.aliases,
  };

  return {
    name: "RedirectsFile",
    async *emit(ctx: BuildCtx, content: ProcessedContent[]) {
      const dest = joinSegments(ctx.argv.output, "_redirects") as FilePath;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(
        dest,
        redirectsFileContents(
          options,
          options.aliases ? collectAliasRules(content ?? [], options.redirects) : [],
        ),
      );
      yield dest;
    },
    async *partialEmit() {},
  };
};
