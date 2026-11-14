// Checks templates the way the panel runs them. The same command runs on
// every pull request.
//
//   bun run check                      every template, and example/
//   bun run check my-app [other...]    only these
//   bun run check --against oldest     with the oldest panel in panel.json
//
// It fails on a TODO left from example/, then runs the panel's own check
// (apps/panel/scripts/check-templates.ts from the Seylo-dev/App ref in
// panel.json, see scripts/lib.ts): meta.yaml, index.ts in the sandbox,
// pinned images, the logo and NOTICE, and a preview and install on an
// in-memory panel. Each problem is one line, "templates/<slug>/<file>: ...".

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkerPath, ensureApp, fail, isReleaseTag, panelRefs, root, runChecker, templateSlugs, todoProblems } from "./lib";
import { scaffold } from "./new";

/** example/, scaffolded the way `bun run new` does it, passes the panel's check. */
function checkExample(app: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "seylo-example-"));
  try {
    scaffold(dir, "example", "Example");
    writeFileSync(join(dir, "NOTICE"), "The example has no logo.\n");
    copyFileSync(join(root, "panel.json"), join(dir, "panel.json"));
    mkdirSync(join(dir, "types"));
    copyFileSync(join(root, "types/templates-utils.d.ts"), join(dir, "types/templates-utils.d.ts"));
    const result = Bun.spawnSync([process.execPath, join(app, checkerPath), "--dir", dir], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) {
      console.log("example/: passes");
      return true;
    }
    const output = `${result.stdout}${result.stderr}`.replaceAll("templates/example/", "example/").replaceAll(dir, "<example>");
    process.stdout.write(output);
    console.log("example/ no longer passes the check; `bun run new` would start every template from a broken one.");
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(args: string[]): number {
  const usage = "usage: bun run check [slug...] [--against check|oldest]";
  let against: "check" | "oldest" = "check";
  const slugs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--against") {
      const value = args[++i];
      if (value !== "check" && value !== "oldest") fail(usage);
      against = value;
    } else if (arg === "-h" || arg === "--help") {
      console.log(usage);
      return 0;
    } else if (arg.startsWith("-")) fail(usage);
    // "templates/my-app/" from tab completion works too.
    else slugs.push(arg.replace(/^templates\//, "").replace(/\/+$/, ""));
  }

  const refs = panelRefs();
  const ref = refs[against];
  if (against === "oldest" && ref === refs.check) {
    console.log(`panel.json: "oldest" is the same App ref as "check" (${ref}); nothing more to check.`);
    return 0;
  }
  let failed = false;

  const todos = todoProblems(slugs.length ? slugs.filter((s) => templateSlugs().includes(s)) : templateSlugs());
  for (const line of todos) console.log(line);
  if (todos.length > 0) failed = true;

  const app = ensureApp(ref);
  const checkArgs = ["--dir", root, ...slugs.flatMap((slug) => ["--only", slug])];
  if (against === "oldest") {
    // Templates whose minPanel is newer than the oldest panel are left out: that panel never shows them.
    if (isReleaseTag(ref)) checkArgs.push("--skip-newer-than", ref);
    else console.log(`panel.json: "oldest" (${ref}) is not a release tag, so templates with a minPanel are checked too.`);
  }
  if (runChecker(app, checkArgs) !== 0) failed = true;

  if (slugs.length === 0 && !checkExample(app)) failed = true;

  if (failed) console.log("\nWhat the messages mean: CONTRIBUTING.md, \"What the check looks at\".");
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
