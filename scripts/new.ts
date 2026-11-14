// Starts a template: copies example/ to templates/<slug>/ with its name
// filled in, then says what to do next.
//
//   bun run new <slug> [--name "Display name"]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, maxSlugLength, root, slugPattern, templateSlugs } from "./lib";

/** Why `slug` cannot be a new template's slug in `dir`, or null. */
export function slugProblem(slug: string, dir = root): string | null {
  if (!slugPattern.test(slug) || slug.length > maxSlugLength)
    return `"${slug}" cannot be a slug: use lower-case letters, digits and dashes, at most ${maxSlugLength}, not starting or ending with a dash. It is the folder name and part of the template's URLs.`;
  if (templateSlugs(dir).some((s) => s.toLowerCase() === slug)) return `templates/${slug} already exists.`;
  return null;
}

/** "my-app" -> "My App". */
export const titleOf = (slug: string) =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** Writes templates/<slug>/meta.yaml and index.ts under `into` from example/. */
export function scaffold(into: string, slug: string, name: string, from = root) {
  const meta = readFileSync(join(from, "example/meta.yaml"), "utf8");
  const code = readFileSync(join(from, "example/index.ts"), "utf8");
  if (!/^name: "Example"$/m.test(meta) || !/^\/\/ Example template:/m.test(code))
    throw new Error('example/ changed: meta.yaml needs a `name: "Example"` line and index.ts a "// Example template:" first line.');
  const dir = join(into, "templates", slug);
  mkdirSync(dir, { recursive: true });
  // A JSON string is a valid double-quoted YAML string.
  writeFileSync(join(dir, "meta.yaml"), meta.replace(/^name: "Example"$/m, () => `name: ${JSON.stringify(name)}`));
  writeFileSync(join(dir, "index.ts"), code.replace(/^\/\/ Example template:/m, () => `// ${name} template:`));
}

function main(args: string[]) {
  const usage = 'usage: bun run new <slug> [--name "Display name"]';
  let slug: string | null = null;
  let name: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--name" && args[i + 1]) name = args[++i] as string;
    else if (!arg.startsWith("-") && slug === null) slug = arg;
    else fail(usage);
  }
  if (slug === null) fail(usage);
  const problem = slugProblem(slug);
  if (problem) fail(problem);
  if (name !== null && (name.trim() === "" || name.length > 60)) fail("--name takes the app's name, at most 60 characters.");
  scaffold(root, slug, name?.trim() ?? titleOf(slug));

  const logo = `templates/${slug}/logo.svg`;
  console.log(`Created templates/${slug}/meta.yaml and index.ts from example/.

Next:
  1. Fill in both files. Each TODO marks something to replace; the check
     fails while one is left. The format is in templates/README.md.
  2. Add the app's logo as ${logo} (or logo.webp, logo.png) and this
     line to NOTICE, under "Template logos", with where the file comes from:

${`  ${logo}`.padEnd(38)}svg/${slug}.svg

     No logo is fine too: the panel then shows the name's first letter.
  3. bun run check ${slug}
  4. Open a pull request (CONTRIBUTING.md).`);
}

if (import.meta.main) main(process.argv.slice(2));
