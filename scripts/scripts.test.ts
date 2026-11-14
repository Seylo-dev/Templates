// Tests for this repository's own scripts (`bun test scripts`). The check
// itself is the App's (apps/panel/scripts/check-templates.ts, tested there);
// here a stand-in App checkout records how check.ts calls it, and
// sign-catalog.sh runs against small git repositories with throwaway keys
// and a stand-in gh.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { panelRefs, todoProblems } from "./lib";
import { scaffold, slugProblem, titleOf } from "./new";

// Most tests run git, bun or minisign several times; a busy runner needs more than 5 s.
setDefaultTimeout(60_000);

const repoRoot = resolve(import.meta.dir, "..");
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(dir: string, files: Record<string, string | Uint8Array>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

function sh(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(cmd, { cwd, env: { ...process.env, GITHUB_ACTIONS: "", ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() };
}

function git(dir: string, ...args: string[]) {
  const result = sh(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], dir);
  if (result.code !== 0) throw new Error(result.out);
  return result.out.trim();
}

/** A repository with this one's scripts, example/ and types/, plus `files`, committed. */
function repo(files: Record<string, string | Uint8Array>) {
  const dir = tempDir("templates-test-");
  for (const path of ["scripts/lib.ts", "scripts/new.ts", "scripts/check.ts", "scripts/build-catalog.ts", "scripts/ci/sign-catalog.sh", "example", "types"])
    cpSync(join(repoRoot, path), join(dir, path), { recursive: true });
  write(dir, { "panel.json": '{ "check": "v0.2.17", "oldest": "v0.2.17" }\n', ...files });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "test");
  return dir;
}

const meta = 'name: "A"\ndescription: "A test."\ncategory: "Other"\ncreates: "App"\n';
const code = 'export function generate(input: { serviceName: string }) {\n  return { services: [] };\n}\n';

describe("bun run new", () => {
  test("refuses slugs the panel cannot use and ones that exist, in any case", () => {
    const dir = repo({ "templates/n8n/meta.yaml": meta, "templates/n8n/index.ts": code });
    for (const slug of ["My_App", "-app", "app-", "app.js", "x".repeat(61), "App"])
      expect(slugProblem(slug, dir)).toContain("cannot be a slug");
    expect(slugProblem("n8n", dir)).toBe("templates/n8n already exists.");
    expect(slugProblem("wiki-js", dir)).toBeNull();
  });

  test("copies example/ with the name filled in, and the copy still has its TODOs", () => {
    const dir = repo({});
    scaffold(dir, "wiki-js", 'Wiki "JS"', dir);
    const scaffolded = readFileSync(join(dir, "templates/wiki-js/meta.yaml"), "utf8");
    expect(scaffolded).toContain('name: "Wiki \\"JS\\""\n');
    expect(scaffolded).not.toContain('name: "Example"');
    expect(readFileSync(join(dir, "templates/wiki-js/index.ts"), "utf8").split("\n")[0]).toStartWith('// Wiki "JS" template:');
    expect(todoProblems(["wiki-js"], dir).length).toBeGreaterThan(5);
    expect(titleOf("uptime-kuma")).toBe("Uptime Kuma");
  });

  test("the command line creates the folder and prints the NOTICE line", () => {
    const dir = repo({});
    const run = sh(["bun", "scripts/new.ts", "wiki-js", "--name", "Wiki.js"], dir);
    expect(run.code).toBe(0);
    expect(run.out).toContain("\n  templates/wiki-js/logo.svg          svg/wiki-js.svg\n");
    expect(readFileSync(join(dir, "templates/wiki-js/meta.yaml"), "utf8")).toContain('name: "Wiki.js"');
    expect(sh(["bun", "scripts/new.ts", "wiki-js"], dir)).toEqual({ code: 1, out: "templates/wiki-js already exists.\n" });
  });
});

describe("panel.json and TODOs", () => {
  test("panel.json refs must be refs, never options or paths up", () => {
    const dir = tempDir("panel-json-");
    for (const bad of ['{ "check": "--upload-pack=x", "oldest": "v0.2.17" }', '{ "check": "a/../b", "oldest": "v0.2.17" }', '{ "check": "v0.2.17" }']) {
      writeFileSync(join(dir, "panel.json"), bad);
      writeFileSync(join(dir, "run.ts"), `import { panelRefs } from ${JSON.stringify(join(repoRoot, "scripts/lib.ts"))};\npanelRefs(${JSON.stringify(dir)});\n`);
      const run = sh(["bun", "run.ts"], dir);
      expect(run.code).toBe(1);
      expect(run.out).toContain("must name a Seylo-dev/App release tag");
    }
    writeFileSync(join(dir, "panel.json"), '{ "check": "v0.2.18", "oldest": "9b9cad76ef5cde1f8b37be36cb0b7cc01d61d43b" }');
    expect(panelRefs(dir)).toEqual({ check: "v0.2.18", oldest: "9b9cad76ef5cde1f8b37be36cb0b7cc01d61d43b" });
  });

  test("a TODO is reported with its line, as a GitHub annotation under Actions", () => {
    const dir = repo({ "templates/a/meta.yaml": `${meta}body: "TODO: write this"\n`, "templates/a/index.ts": code });
    expect(todoProblems(["a"], dir)).toEqual([
      "templates/a/meta.yaml:5: A TODO from the example is still here: fill it in, then remove the TODO.",
    ]);
    process.env.GITHUB_ACTIONS = "true";
    try {
      expect(todoProblems(["a"], dir)[0]).toBe(
        "::error file=templates/a/meta.yaml,line=5::A TODO from the example is still here: fill it in, then remove the TODO.",
      );
    } finally {
      delete process.env.GITHUB_ACTIONS;
    }
  });
});

describe("bun run check", () => {
  /** An App checkout whose check-templates.ts prints its arguments; it fails for the example when FAIL_EXAMPLE is set. */
  function fakeApp() {
    const dir = tempDir("fake-app-");
    write(dir, {
      "node_modules/.keep": "",
      "apps/panel/scripts/check-templates.ts": `const args = process.argv.slice(2);
const dir = args[args.indexOf("--dir") + 1] ?? "";
console.log("checker " + JSON.stringify(args.map((a) => (a === dir ? (a.includes("seylo-example-") ? "<example>" : "<repo>") : a))));
if (process.env.FAIL_EXAMPLE && dir.includes("seylo-example-")) {
  console.log("templates/example/index.ts: generate() threw");
  process.exit(1);
}
process.exit(Number(process.env.CHECKER_EXIT ?? 0));
`,
    });
    return dir;
  }

  test("checks every template and the example with the panel's checker", () => {
    const dir = repo({ "templates/a/meta.yaml": meta, "templates/a/index.ts": code, NOTICE: "x\n" });
    const run = sh(["bun", "scripts/check.ts"], dir, { SEYLO_APP_DIR: fakeApp() });
    expect(run.code).toBe(0);
    expect(run.out).toContain('checker ["--dir","<repo>"]');
    expect(run.out).toContain("example/: passes");
  });

  test("named templates only, and a checker failure fails the run", () => {
    const dir = repo({ "templates/a/meta.yaml": meta, "templates/a/index.ts": code, NOTICE: "x\n" });
    const run = sh(["bun", "scripts/check.ts", "templates/a/"], dir, { SEYLO_APP_DIR: fakeApp(), CHECKER_EXIT: "1" });
    expect(run.code).toBe(1);
    expect(run.out).toContain('checker ["--dir","<repo>","--only","a"]');
    expect(run.out).not.toContain("<example>");
  });

  test("a TODO fails the run", () => {
    const dir = repo({ "templates/a/meta.yaml": `${meta}body: "TODO"\n`, "templates/a/index.ts": code, NOTICE: "x\n" });
    const run = sh(["bun", "scripts/check.ts"], dir, { SEYLO_APP_DIR: fakeApp() });
    expect(run.code).toBe(1);
    expect(run.out).toContain("templates/a/meta.yaml:5: A TODO from the example is still here");
  });

  test("a broken example fails the run, with example/ paths", () => {
    const dir = repo({ "templates/a/meta.yaml": meta, "templates/a/index.ts": code, NOTICE: "x\n" });
    const run = sh(["bun", "scripts/check.ts"], dir, { SEYLO_APP_DIR: fakeApp(), FAIL_EXAMPLE: "1" });
    expect(run.code).toBe(1);
    expect(run.out).toContain("example/index.ts: generate() threw");
    expect(run.out).toContain("example/ no longer passes the check");
  });

  test("--against oldest skips templates for newer panels, or does nothing when oldest is check", () => {
    const dir = repo({ "templates/a/meta.yaml": meta, "templates/a/index.ts": code, NOTICE: "x\n" });
    const same = sh(["bun", "scripts/check.ts", "--against", "oldest"], dir, { SEYLO_APP_DIR: fakeApp() });
    expect(same).toEqual({ code: 0, out: 'panel.json: "oldest" is the same App ref as "check" (v0.2.17); nothing more to check.\n' });
    writeFileSync(join(dir, "panel.json"), '{ "check": "v0.2.18", "oldest": "v0.2.17" }');
    const older = sh(["bun", "scripts/check.ts", "--against", "oldest"], dir, { SEYLO_APP_DIR: fakeApp() });
    expect(older.code).toBe(0);
    expect(older.out).toContain('checker ["--dir","<repo>","--skip-newer-than","v0.2.17"]');
  });
});

test("bun run build refuses a shallow clone, whose commit count is not the sequence", () => {
  const dir = repo({ "templates/a/meta.yaml": meta, "templates/a/index.ts": code });
  write(dir, { "templates/a/index.ts": `${code}// two\n` });
  git(dir, "commit", "-q", "-am", "second");
  const shallow = join(tempDir("shallow-"), "repo");
  git(dirname(shallow), "clone", "-q", "--depth", "1", `file://${dir}`, shallow);
  const run = sh(["bun", "scripts/build-catalog.ts"], shallow);
  expect(run.code).toBe(1);
  expect(run.out).toContain("This is a shallow clone");
});

// ---- scripts/ci/sign-catalog.sh ---------------------------------------------

// CI installs minisign before the tests (scripts/ci/install-minisign.sh); jq and yq come with the runner image.
const yamlReader =
  (Bun.which("yq") !== null && sh(["yq", "--version"], repoRoot).out.includes("mikefarah")) ||
  sh(["python3", "-E", "-c", "import yaml"], tmpdir()).code === 0;
if (Bun.which("minisign") === null || Bun.which("jq") === null || !yamlReader)
  test.skip("sign-catalog.sh (needs minisign, jq, and yq or python3 with PyYAML)", () => {});
else
describe("sign-catalog.sh", () => {
  const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const logo = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 1, 2, 255]);
  const repoFiles = {
    "templates/a/meta.yaml": meta,
    "templates/a/index.ts": code,
    "templates/a/logo.webp": logo,
    "templates/b/meta.yaml": `${meta.replace('"A"', '"B"')}tags: ["x", "y"]\nminPanel: "0.2.17"\n`,
    "templates/b/index.ts": code,
    "templates/README.md": "Not a template.\n",
    NOTICE: "Logos\n  templates/a/logo.webp   drawn for this test\n",
    "LICENSE.icons": "Icon license\n",
    LICENSE: "Not shipped\n",
  };

  function keypair(password = "") {
    const dir = tempDir("key-");
    const input = password ? `${password}\n${password}\n` : "";
    const run = Bun.spawnSync(["minisign", "-G", ...(password ? [] : ["-W"]), "-p", `${dir}/catalog.pub`, "-s", `${dir}/catalog.key`], {
      stdin: new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString());
    return { secret: `${dir}/catalog.key`, pub: readFileSync(`${dir}/catalog.pub`, "utf8").split("\n")[1] as string, pubFile: readFileSync(`${dir}/catalog.pub`, "utf8") };
  }

  /** check-templates.ts --emit's copies of each meta.yaml in repoFiles. */
  const copies = {
    a: { minPanel: null, name: "A", description: "A test.", category: "Other", creates: "App", tags: [] },
    b: { minPanel: "0.2.17", name: "B", description: "A test.", category: "Other", creates: "App", tags: ["x", "y"] },
  };

  /** The catalog check-templates.ts --emit would write for `dir`'s HEAD, changed by `edit`. */
  function catalog(dir: string, edit: (c: any) => void = () => {}) {
    const file = (path: string) => new Uint8Array(readFileSync(join(dir, path)));
    const entry = (name: string, bytes: Uint8Array) =>
      name === "logo.webp" ? { sha256: sha256(bytes), base64: Buffer.from(bytes).toString("base64") } : { sha256: sha256(bytes), text: new TextDecoder().decode(bytes) };
    const value: any = {
      format: 1,
      source: "Seylo-dev/Templates",
      commit: git(dir, "rev-parse", "HEAD"),
      sequence: Number(git(dir, "rev-list", "--count", "HEAD")),
      generatedAt: new Date().toISOString(),
      notice: readFileSync(join(dir, "NOTICE"), "utf8"),
      licenses: { "LICENSE.icons": readFileSync(join(dir, "LICENSE.icons"), "utf8") },
      templates: [
        { slug: "a", ...copies.a, files: Object.fromEntries(["index.ts", "logo.webp", "meta.yaml"].map((n) => [n, entry(n, file(`templates/a/${n}`))])) },
        { slug: "b", ...copies.b, files: Object.fromEntries(["index.ts", "meta.yaml"].map((n) => [n, entry(n, file(`templates/b/${n}`))])) },
      ],
    };
    edit(value);
    const out = tempDir("catalog-");
    writeFileSync(join(out, "catalog.json"), JSON.stringify(value, null, 2));
    return out;
  }

  const key = keypair();
  const signed = repo({ ...repoFiles, "catalog.pub": key.pubFile });
  const sign = (out: string, env: Record<string, string> = {}, dir = signed) =>
    sh(["bash", "scripts/ci/sign-catalog.sh", "sign", out], dir, { MINISIGN_SECRET_KEY: key.secret, MINISIGN_PASSWORD: "", ...env });

  test("signs a catalog that is HEAD's templates byte for byte, verifiable with catalog.pub", () => {
    const out = catalog(signed);
    const run = sign(out);
    expect(run.out).toContain("catalog.json holds HEAD's 2 templates byte for byte");
    expect(run.code).toBe(0);
    const verify = sh(["minisign", "-V", "-P", key.pub, "-m", `${out}/catalog.json`], signed);
    expect(verify.code).toBe(0);
    expect(verify.out).toContain(`Trusted comment: seylo templates catalog seq=1 commit=${git(signed, "rev-parse", "HEAD")}`);
  });

  test("refuses anything that is not exactly HEAD's templates", () => {
    const cases: [string, (c: any) => void][] = [
      ["templates/a/index.ts in the catalog is not the file in HEAD", (c) => {
        const text = `${code}fetch("https://example.com")\n`;
        c.templates[0].files["index.ts"] = { sha256: sha256(text), text };
      }],
      ["templates/a/logo.webp in the catalog is not the file in HEAD", (c) => {
        c.templates[0].files["logo.webp"].base64 = Buffer.from("other").toString("base64");
      }],
      ["templates/b/meta.yaml: the catalog's sha256 for it is wrong", (c) => {
        c.templates[1].files["meta.yaml"].sha256 = "0".repeat(64);
      }],
      ["only in the catalog: extra", (c) => c.templates.push({ slug: "extra", files: {} })],
      ["only in the catalog: b", (c) => c.templates.push(structuredClone(c.templates[1]))],
      ["only in HEAD: b", (c) => c.templates.pop()],
      ["templates/a: the catalog has index.ts meta.yaml and HEAD has index.ts logo.webp meta.yaml", (c) => {
        delete c.templates[0].files["logo.webp"];
      }],
      ["the catalog's notice is not HEAD's NOTICE", (c) => (c.notice = "")],
      ["the catalog's LICENSE.icons is not HEAD's", (c) => (c.licenses["LICENSE.icons"] = "MIT\n")],
      ["the catalog's licenses (LICENSE LICENSE.icons ) are not HEAD's LICENSE.* files (LICENSE.icons )", (c) => (c.licenses.LICENSE = "x")],
      ["the catalog was built from 0000000000000000000000000000000000000000", (c) => (c.commit = "0".repeat(40))],
      ["the catalog's sequence is 7, not HEAD's commit count (1)", (c) => (c.sequence = 7)],
      ["the catalog's source is someone/Templates", (c) => (c.source = "someone/Templates")],
      ["the catalog has format 2, not 1", (c) => (c.format = 2)],
      // The copies the website shows, and anything format 1 does not have.
      ['templates/a: the catalog\'s name, description, category, creates, tags and minPanel are {"category":"Other","creates":"App","description":"A test.","minPanel":null,"name":"Evil name","tags":[]}, not meta.yaml\'s {"category":"Other","creates":"App","description":"A test.","minPanel":null,"name":"A","tags":[]}', (c) => (c.templates[0].name = "Evil name")],
      ["templates/b: the catalog's name, description, category, creates, tags and minPanel are", (c) => (c.templates[1].tags = ["x"])],
      ["templates/b: the catalog's name, description, category, creates, tags and minPanel are", (c) => (c.templates[1].minPanel = null)],
      ["templates/a: the catalog's name, description, category, creates, tags and minPanel are", (c) => (c.templates[0].category = "Security")],
      ["templates/a: the catalog's name, description, category, creates, tags and minPanel are", (c) => delete c.templates[0].tags],
      ["the catalog has keys format 1 does not: extra", (c) => (c.extra = { homepage: "https://example.com" })],
      ["keys format 1 does not have: templates/b has homepage", (c) => (c.templates[1].homepage = "https://example.com")],
      ["templates/a/index.ts in the catalog is not {sha256, text}", (c) => (c.templates[0].files["index.ts"].note = "x")],
      ["templates/a/logo.webp in the catalog is not {sha256, text}", (c) => (c.templates[0].files["logo.webp"].text = "x")],
      ["a template in the catalog is not an object with a slug and files", (c) => c.templates.push("c")],
      ["the catalog's generatedAt (2099-01-01T00:00:00.000Z) is not between HEAD's commit time and now", (c) => (c.generatedAt = "2099-01-01T00:00:00.000Z")],
      ["the catalog's generatedAt (2001-01-01T00:00:00.000Z) is not between HEAD's commit time and now", (c) => (c.generatedAt = "2001-01-01T00:00:00.000Z")],
      ["the catalog's generatedAt (yesterday) is not a time", (c) => (c.generatedAt = "yesterday")],
    ];
    for (const [message, edit] of cases) {
      const out = catalog(signed, edit);
      const run = sign(out);
      expect(run.out).toContain(message);
      expect(run.code).toBe(1);
      expect(sh(["test", "-e", `${out}/catalog.json.minisig`], out).code).toBe(1);
    }
  });

  test("refuses another key than catalog.pub's, a wrong password, and a placeholder or garbled catalog.pub", () => {
    const other = keypair();
    expect(sign(catalog(signed), { MINISIGN_SECRET_KEY: other.secret }).out).toContain("MINISIGN_SECRET_KEY is another key");

    const locked = keypair("hunter22hunter22");
    const lockedRepo = repo({ ...repoFiles, "catalog.pub": locked.pubFile });
    const env = { MINISIGN_SECRET_KEY: locked.secret };
    expect(sign(catalog(lockedRepo), { ...env, MINISIGN_PASSWORD: "wrong" }, lockedRepo).out).toContain("wrong MINISIGN_PASSWORD?");
    expect(sign(catalog(lockedRepo), { ...env, MINISIGN_PASSWORD: "hunter22hunter22" }, lockedRepo).code).toBe(0);

    const placeholder = repo({ ...repoFiles, "catalog.pub": "untrusted comment: placeholder\nPLACEHOLDER_TEMPLATES_MINISIGN_PUBLIC_KEY\n" });
    const run = sign(catalog(placeholder), {}, placeholder);
    expect(run.code).toBe(1);
    expect(run.out).toContain("catalog.pub holds no key yet");
    // The dry run's throwaway key stands in for it.
    expect(sign(catalog(placeholder), { CATALOG_PUBLIC_KEY: key.pub }, placeholder).code).toBe(0);

    const garbled = repo({ ...repoFiles, "catalog.pub": `untrusted comment: cut short\n${key.pub.slice(0, 40)}\n` });
    expect(sign(catalog(garbled), {}, garbled).out).toContain("catalog.pub's second line is not a minisign public key");
  });

  test("this repository's catalog.pub is the Seylo release key and refuses any other secret key", () => {
    const pubFile = readFileSync(join(repoRoot, "catalog.pub"), "utf8");
    const [comment, pub] = pubFile.split("\n");
    expect(comment).toStartWith("untrusted comment: Seylo release key");
    expect(pub).toBe("RWTwvrETQsecIkFOCm1ceiZwfxVq6sFfiEmJfWnUVv7UBIn0jWm2h1ip");
    // "Ed", then the key id the comment names (little-endian), then the 32-byte key.
    const bytes = Buffer.from(pub as string, "base64");
    expect(bytes.length).toBe(42);
    expect(bytes.subarray(0, 2).toString()).toBe("Ed");
    expect(comment).toContain(`minisign public key ${Buffer.from(bytes.subarray(2, 10)).reverse().toString("hex").toUpperCase()}`);

    const released = repo({ ...repoFiles, "catalog.pub": pubFile });
    const out = catalog(released);
    const run = sign(out, {}, released);
    expect(run.code).toBe(1);
    expect(run.out).toContain("the signature does not verify with catalog.pub: MINISIGN_SECRET_KEY is another key");
    expect(sh(["test", "-e", `${out}/catalog.json.minisig`], out).code).toBe(1);
  });

  describe("upload", () => {
    /** gh release view/create/upload/edit/download on a folder. */
    function fakeGh() {
      const bin = tempDir("gh-");
      write(bin, {
        gh: `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = release ] || exit 2
sub=$2
shift 3
pattern="" dir="" files=""
while [ $# -gt 0 ]; do
  case $1 in
  --repo | --json | --title | --notes) shift 2 ;;
  --latest=* | --clobber) shift ;;
  --pattern) pattern=$2; shift 2 ;;
  --dir) dir=$2; shift 2 ;;
  *) files="$files $1"; shift ;;
  esac
done
case $sub in
view | edit) [ -d "$FAKE_RELEASE" ] ;;
create) mkdir -p "$FAKE_RELEASE"; echo created >"$FAKE_RELEASE.created" ;;
upload) for f in $files; do cp "$f" "$FAKE_RELEASE/"; done ;;
download)
  found=0
  for f in "$FAKE_RELEASE"/$pattern; do [ -e "$f" ] && cp "$f" "$dir/" && found=1; done
  [ "$found" = 1 ] ;;
esac
`,
      });
      chmodSync(join(bin, "gh"), 0o755);
      return bin;
    }

    function upload(out: string, published?: (c: any) => void) {
      const release = join(tempDir("release-"), "catalog");
      if (published) {
        mkdirSync(release);
        const old = catalog(signed, published);
        cpSync(join(old, "catalog.json"), join(release, "catalog.json"));
      }
      const run = sh(["bash", "scripts/ci/sign-catalog.sh", "upload", out], signed, {
        PATH: `${fakeGh()}:${process.env.PATH}`,
        FAKE_RELEASE: release,
        GITHUB_REPOSITORY: "Seylo-dev/Templates",
      });
      return { ...run, release };
    }

    function signedCatalog() {
      const out = catalog(signed);
      expect(sign(out).code).toBe(0);
      return out;
    }

    test("creates the release on first use, uploads both files and verifies what it serves", () => {
      const out = signedCatalog();
      const run = upload(out);
      expect(run.out).toContain("sign-catalog: published sequence 1");
      expect(run.code).toBe(0);
      expect(readFileSync(`${run.release}.created`, "utf8")).toBe("created\n");
      expect(readFileSync(join(run.release, "catalog.json.minisig"), "utf8")).toBe(readFileSync(join(out, "catalog.json.minisig"), "utf8"));
    });

    test("replaces an older catalog and names the templates that left", () => {
      const run = upload(signedCatalog(), (c) => {
        c.sequence = 0;
        c.templates.push({ slug: "gone", files: {} });
      });
      expect(run.code).toBe(0);
      expect(run.out).toContain("no longer in the catalog: gone");
    });

    test("refuses to go below the published sequence, or to replace it from another commit", () => {
      const higher = upload(signedCatalog(), (c) => (c.sequence = 9));
      expect(higher.code).toBe(1);
      expect(higher.out).toContain("the published catalog has sequence 9");
      const rewritten = upload(signedCatalog(), (c) => (c.commit = "f".repeat(40)));
      expect(rewritten.code).toBe(1);
      expect(rewritten.out).toContain(`the published catalog has sequence 1 (commit ${"f".repeat(40)})`);
      expect(readFileSync(join(rewritten.release, "catalog.json"), "utf8")).toContain("f".repeat(40));
    });

    test("refuses a catalog without its signature", () => {
      const run = upload(catalog(signed));
      expect(run.code).toBe(1);
      expect(run.out).toContain("catalog.json.minisig is missing");
    });
  });
});
