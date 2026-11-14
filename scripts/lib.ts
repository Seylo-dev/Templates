// Shared by the scripts: the repository, panel.json, and the Seylo-dev/App
// checkout the check runs from.
//
// The check is the panel's own code (apps/panel/scripts/check-templates.ts
// in Seylo-dev/App), so a template passes here exactly when that version of
// the panel would take it. panel.json names the App refs: "check" for every
// check, "oldest" for the oldest panel the templates must still work on.
// The first run fetches the ref into .cache/ and installs its packages
// (bun install); later runs reuse it.
//
//   SEYLO_APP_DIR=<path>   use an App checkout you already have, say to try a
//                          template against panel changes you are making
//   SEYLO_APP_REPO=<url>   fetch the ref from another clone of the App

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dir, "..");
export const checkerPath = "apps/panel/scripts/check-templates.ts";
export const slugPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const maxSlugLength = 60;
const github = () => process.env.GITHUB_ACTIONS === "true";

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export interface PanelRefs {
  check: string;
  oldest: string;
}

/** A ref git can take as an argument: a tag, a branch or a commit, never an option. */
const refPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export function panelRefs(dir = root): PanelRefs {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(dir, "panel.json"), "utf8"));
  } catch (error) {
    fail(`panel.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const refs = (value ?? {}) as Record<string, unknown>;
  for (const key of ["check", "oldest"]) {
    const ref = refs[key];
    if (typeof ref !== "string" || !refPattern.test(ref) || ref.includes(".."))
      fail(`panel.json: "${key}" must name a Seylo-dev/App release tag (such as v0.2.17) or commit.`);
  }
  return { check: refs.check as string, oldest: refs.oldest as string };
}

/** "v0.2.17" is a release; a commit or a branch is not. */
export const isReleaseTag = (ref: string) => /^v\d+\.\d+\.\d+$/.test(ref);

/** The template folders under templates/, sorted. */
export function templateSlugs(dir = root): string[] {
  const folder = join(dir, "templates");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => statSync(join(folder, name)).isDirectory())
    .sort();
}

/**
 * Lines that still carry a TODO from example/ ("templates/<slug>/<file>:<line>: ...").
 * The example marks everything a new template has to replace with TODO.
 */
export function todoProblems(slugs: string[], dir = root): string[] {
  const out: string[] = [];
  for (const slug of slugs)
    for (const file of ["meta.yaml", "index.ts"]) {
      const path = join(dir, "templates", slug, file);
      if (!existsSync(path)) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!/\bTODO\b/.test(line)) return;
          const where = `templates/${slug}/${file}`;
          const message = "A TODO from the example is still here: fill it in, then remove the TODO.";
          if (github()) out.push(`::error file=${where},line=${i + 1}::${message}`);
          out.push(`${where}:${i + 1}: ${message}`);
        });
    }
  return out;
}

function run(cmd: string[], cwd: string, what: string) {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`${what} failed: ${cmd.join(" ")}`);
  }
}

/** The App checkout for `ref`, fetched and installed on first use. */
export function ensureApp(ref: string): string {
  const own = process.env.SEYLO_APP_DIR;
  if (own) {
    const dir = resolve(own);
    if (!existsSync(join(dir, checkerPath)))
      fail(`SEYLO_APP_DIR=${own} has no ${checkerPath}. Point it at a Seylo-dev/App checkout from ${ref} or newer.`);
    if (!existsSync(join(dir, "node_modules")))
      run([process.execPath, "install", "--frozen-lockfile"], dir, "Installing the App's packages");
    console.error(`Checking with the App checkout in ${dir} (SEYLO_APP_DIR) instead of ${ref}.`);
    return dir;
  }
  const dir = join(root, ".cache", `app-${ref.replaceAll("/", "_")}`);
  if (existsSync(join(dir, ".ready"))) return dir;
  const url = process.env.SEYLO_APP_REPO || "https://github.com/Seylo-dev/App";
  console.error(`Fetching Seylo-dev/App ${ref} into .cache/ and installing its packages (first run only)...`);
  rmSync(dir, { recursive: true, force: true }); // what an interrupted run left behind
  mkdirSync(dir, { recursive: true });
  run(["git", "init", "-q"], dir, "git init");
  run(["git", "fetch", "-q", "--depth", "1", url, ref], dir, `Fetching ${ref} from ${url}`);
  run(["git", "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"], dir, "git checkout");
  if (!existsSync(join(dir, checkerPath))) fail(`Seylo-dev/App ${ref} has no ${checkerPath}; the check needs v0.2.17 or newer.`);
  run([process.execPath, "install", "--frozen-lockfile"], dir, "Installing the App's packages");
  writeFileSync(join(dir, ".ready"), `${ref}\n`);
  return dir;
}

/** Runs the App's check-templates.ts; its output goes straight to ours. Returns the exit code. */
export function runChecker(app: string, args: string[]): number {
  const result = Bun.spawnSync([process.execPath, join(app, checkerPath), ...args], {
    cwd: app,
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode ?? 1;
}
