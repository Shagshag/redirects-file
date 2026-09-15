import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BuildCtx, FilePath } from "@quartz-community/types";
import { RedirectsFile } from "../src/index.js";

function makeBuildCtx(outputDir: string): BuildCtx {
  return {
    buildId: "test-build",
    argv: {
      directory: "content",
      verbose: false,
      output: outputDir,
      serve: false,
      watch: false,
      port: 8080,
      wsPort: 3001,
    },
    cfg: {
      configuration: {},
      plugins: { transformers: [], filters: [], emitters: [], pageTypes: [] },
    },
    allSlugs: [],
    allFiles: [],
    incremental: false,
  } as unknown as BuildCtx;
}

async function readRedirects(outputDir: string): Promise<string> {
  return fs.readFile(path.join(outputDir, "_redirects"), "utf-8");
}

describe("RedirectsFile", () => {
  let tmpDir: string;
  let ctx: BuildCtx;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "redirects-file-test-"));
    ctx = makeBuildCtx(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits only the catch-all rewrite by default", async () => {
    const plugin = RedirectsFile();
    const emitted: FilePath[] = [];
    for await (const fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      emitted.push(fp);
    }
    expect(emitted).toHaveLength(1);

    const contents = await readRedirects(tmpDir);
    expect(contents).toBe("/*  /:splat.html  200\n");
  });

  it("omits the catch-all rewrite when disabled", async () => {
    const plugin = RedirectsFile({ catchAllRewrite: false });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents).toBe("");
  });

  it("writes explicit rules before the catch-all, defaulting to 301", async () => {
    const plugin = RedirectsFile({
      redirects: [{ from: "old-page", to: "new-page" }],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents).toBe("/old-page /new-page 301\n/*  /:splat.html  200\n");
  });

  it("respects a custom status code", async () => {
    const plugin = RedirectsFile({
      redirects: [{ from: "temp-page", to: "other-page", status: 302 }],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents).toContain("/temp-page /other-page 302");
  });

  it("URL-encodes rule paths the way a browser would (not encodeURIComponent)", async () => {
    const plugin = RedirectsFile({
      redirects: [
        {
          from: "développement/`class`-ou-`alias`,-un-choix-d'ingénierie",
          to: "developpement/class-ou-alias-un-choix-d-ingenierie",
        },
      ],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    const [firstLine] = contents.split("\n");
    // backticks and accents are escaped; commas and apostrophes (valid
    // sub-delimiters in a path) are left as browsers leave them.
    expect(firstLine).toBe(
      "/d%C3%A9veloppement/%60class%60-ou-%60alias%60,-un-choix-d'ing%C3%A9nierie" +
        " /developpement/class-ou-alias-un-choix-d-ingenierie 301",
    );
  });

  it("strips a leading slash from rule paths before encoding", async () => {
    const plugin = RedirectsFile({
      redirects: [{ from: "/old-page", to: "/new-page" }],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents.split("\n")[0]).toBe("/old-page /new-page 301");
  });

  it("does not prefix an absolute URL destination with a slash", async () => {
    const plugin = RedirectsFile({
      redirects: [{ from: "old-dashboard", to: "https://example.com/new-dashboard" }],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents.split("\n")[0]).toBe("/old-dashboard https://example.com/new-dashboard 301");
  });

  it("treats a protocol-relative destination as absolute too", async () => {
    const plugin = RedirectsFile({
      redirects: [{ from: "old-page", to: "//example.com/new-page" }],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents.split("\n")[0]).toBe("/old-page //example.com/new-page 301");
  });

  it("falls back to the default empty redirect list when options.redirects is null", async () => {
    const plugin = RedirectsFile({ redirects: null as unknown as undefined });
    const emitted: FilePath[] = [];
    for await (const fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      emitted.push(fp);
    }
    expect(emitted).toHaveLength(1);
    const contents = await readRedirects(tmpDir);
    expect(contents).toBe("/*  /:splat.html  200\n");
  });

  it("writes multiple rules in the given order", async () => {
    const plugin = RedirectsFile({
      redirects: [
        { from: "a", to: "b" },
        { from: "c", to: "d" },
      ],
    });
    for await (const _fp of plugin.emit(ctx, [], {} as never) as AsyncGenerator<FilePath>) {
      // drain
    }
    const contents = await readRedirects(tmpDir);
    expect(contents).toBe("/a /b 301\n/c /d 301\n/*  /:splat.html  200\n");
  });

  it("partialEmit yields nothing (the file is only regenerated on a full build)", async () => {
    const plugin = RedirectsFile();
    const emitted: FilePath[] = [];
    for await (const fp of plugin.partialEmit!(
      ctx,
      [],
      {} as never,
      [],
    ) as AsyncGenerator<FilePath>) {
      emitted.push(fp);
    }
    expect(emitted).toHaveLength(0);
  });
});
