// Checks every template and writes the catalog panels download.
//
//   bun run build [--out <file>]       (default: catalog.json)
//
// The catalog is one JSON file in the format of the App's
// apps/panel/src/modules/templates/catalog-file.ts, written by the App's
// check-templates.ts --emit, so it only exists when every template passes.
// Its commit is HEAD and its sequence the number of commits up to HEAD:
// panels refuse a catalog with a lower sequence than one they already have,
// so this needs the full history (a shallow clone would count 1). It is not
// signed here: the Publish workflow's Sign job checks and signs it
// (scripts/ci/sign-catalog.sh).

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureApp, fail, panelRefs, root, runChecker, templateSlugs, todoProblems } from "./lib";

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

function main(args: string[]): number {
  let out = "catalog.json";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) out = args[++i] as string;
    else fail("usage: bun run build [--out <file>]");
  }
  if (git("rev-parse", "--is-shallow-repository") === "true")
    fail("This is a shallow clone, so the catalog's sequence (the commit count) would be wrong. Fetch the full history (git fetch --unshallow; in Actions, fetch-depth: 0).");
  if (git("status", "--porcelain", "--", "templates", ":!templates/README.md", "NOTICE", "LICENSE.*") !== "")
    console.error(`warning: templates/ or NOTICE has uncommitted changes, so the catalog does not match commit ${git("rev-parse", "--short", "HEAD")}.`);

  const todos = todoProblems(templateSlugs());
  for (const line of todos) console.log(line);
  if (todos.length > 0) return 1;

  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  return runChecker(ensureApp(panelRefs().check), ["--dir", root, "--emit", path]);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
