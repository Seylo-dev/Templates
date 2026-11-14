# Contributing

New templates and fixes to existing ones are welcome. One template per pull
request, please.

## Adding a template

You need [Bun](https://bun.sh) 1.4.4 or newer and git.

1. Fork and clone this repository.
2. `bun run new <slug>`. The slug is the folder name and part of the
   template's URLs: lower-case letters, digits and dashes, such as
   `uptime-kuma`. Pass `--name "Uptime Kuma"` when the app's name is not
   the slug in title case. This copies [`example/`](example) to
   `templates/<slug>/`.
3. Fill in `meta.yaml` and `index.ts`. Every line marked TODO needs your
   attention, and the check fails while one is left. The format is in
   [templates/README.md](templates/README.md); the existing templates are
   good references (`n8n` for an app with Postgres, `plausible` for two
   apps and a command, `prometheus` for a config file).
4. Add the logo (templates/README.md, "Logo") and its line in `NOTICE`.
   `bun run new` prints the line.
5. `bun run check <slug>`, until it prints no problems.
6. Open a pull request and fill in its checklist.

`bun run check` with no slug checks every template and `example/`, which
is what CI runs. The first run fetches the Seylo panel code it checks with
(the Seylo-dev/App version in `panel.json`) into `.cache/` and installs its
packages; later runs take a second or two.

### Trying it on a panel

The check previews and installs the template on an in-memory panel, but it
does not pull the image or start the app. Starting the app is the part a
reviewer cannot see, so please try it on a Seylo panel (0.2.17 or newer) if
you have one:

1. `bun run build` writes `catalog.json` with your templates.
2. Put it on any https URL (a GitHub gist's raw URL works).
3. On the panel, as its owner: Templates, "Catalog source", "Add a private
   catalog", that URL, and "Allow it without a signature".
4. Install the template, deploy, and open the app. Say in the pull request
   what you tried.

A template with the same slug as an official one is hidden behind it, so to
try a change to an existing template, copy its folder to a new slug first.
Remove the private catalog afterwards.

## What the check looks at

`bun run check` runs the panel's own code (`apps/panel/scripts/check-templates.ts`
in Seylo-dev/App), so a template that passes is one the panel takes. Each
problem is one line, `templates/<slug>/<file>: message`:

- **TODOs.** A line still marked TODO from `example/`.
- **The folder.** The slug's form, no two slugs that differ only in case,
  only `meta.yaml`, `index.ts` and one logo file in it.
- **meta.yaml.** It parses, has the required keys, and no keys the format
  does not know (a typo such as `descripton` is an error); lengths, https
  links, a known category (a new one is a warning), and `minPanel` no newer
  than the panel checked against.
- **index.ts.** It compiles, `generate` runs in the sandbox with the form's
  defaults (twice, with different service names), returns valid services,
  and every service name starts with `input.serviceName`.
- **Images.** Every image is pinned: a version tag or a digest, never
  `latest`, `stable`, `main`, `nightly` or `edge`.
- **Installing.** The template is previewed and installed through the same
  steps as the Templates page, on an in-memory panel with one node, so
  references (`ref()`), volumes, ports and domains must all resolve.
- **The logo.** File type, size, no active SVG content, and a line in
  `NOTICE`. `NOTICE` must not list files that do not exist.
- **The editor types.** `types/templates-utils.d.ts` declares exactly what
  the panel's `~templates-utils` exports.

## What reviewers look for

- The app is open source or free to self-host, and its project publishes
  the image.
- The newest stable version, pinned. A pull request that only bumps a
  version is welcome; link the release notes.
- Secrets are generated for every install (`format: "password"`,
  `randomPassword()`, `randomHex()`), never fixed in the template.
- Data the app keeps is on a volume, so a redeploy or an update keeps it.
- The defaults work: a user who changes nothing in the form gets a working
  app.
- `body` says what to do after the first deploy (create the admin account,
  finish a setup page) and anything that is easy to get wrong.
- Written for Seylo. Do not copy templates from other catalogs: their
  licenses may not allow it.

## Updating or removing a template

Same steps, without `bun run new`. Installed services do not change when
their template does; a new version of a template only affects new installs.
Removing a template removes it from the Templates page of every panel at
its next check; services installed from it keep running.

## For maintainers

### panel.json

`check` is the Seylo-dev/App version every check runs; `oldest` is the
oldest panel the catalog supports. Both are release tags (`v0.2.17`) or, for
work ahead of a release, an App commit.

- After an App release that adds something templates can use, raise
  `check` to that tag. Templates that use the new thing set `minPanel` to
  it.
- Raise `oldest` only to drop support for older panels. Templates whose
  `minPanel` is newer than `oldest` are left out of the `oldest` check,
  which is what makes `minPanel` honest.

Until Seylo 0.2.17 is released, both name an App commit with the current
`check-templates.ts` (`a359d7c7`). CI and `bun run check` fetch that exact
commit from Seylo-dev/App, so push it there before this repository, and
never squash, rebase or amend it away afterwards: a commit GitHub no
longer has fails every check. At the release, set both to `v0.2.17`.

Set "Templates (panel.json check)", "Templates (panel.json oldest)",
"Catalog (build and sign with a throwaway key)" and "Workflows (zizmor)"
as required checks on `main`, and never force-push `main` (see
Publishing).

### Publishing

`.github/workflows/publish.yml` runs on every push to `main`: the Build job
checks every template and builds `catalog.json`; the Sign job checks that
the catalog holds exactly that commit's templates (and that the name,
category and other fields copied next to each slug, which the website
shows, are its `meta.yaml`'s), signs it and replaces
`catalog.json` and `catalog.json.minisig` on the `catalog` release.

- The catalog's sequence is `main`'s commit count, and panels refuse a
  catalog with a lower sequence than one they already have. Rewriting
  `main`'s history (a force push that drops commits) would lower it, so the
  Sign job refuses to publish then. Do not force-push `main`.
- Keep release immutability off for this repository: the `catalog` release
  is replaced on every merge.
- Seylo releases ship a copy of the catalog (Seylo-dev/App
  `make sync-templates`, run before tagging).

### Signing key

The catalog is signed with the Seylo release key, the same minisign key
that signs Seylo releases. `catalog.pub` is its public key (the
`minisignPublicKey` in Seylo-dev/App `brand/brand.json`), and the Sign job
refuses to publish a signature that does not verify with it. The secret
key lives only in the `catalog` environment, which only `main` can deploy
to and only the Sign job reads; that job runs no bun, npm or template
code. What it runs is in `.github/` and `scripts/`, which need the owner's
review (CODEOWNERS).

Setup is two secrets, nothing to generate or commit. In Settings >
Environments:

1. Create `catalog` with `main` as its only deployment branch.
2. Add the secrets `MINISIGN_SECRET_KEY` and `MINISIGN_PASSWORD`, the same
   values as the `release` environment of Seylo-dev/App.

Until the secrets exist, the Publish workflow builds and checks the
catalog but publishes nothing, and says so in the run summary. Once they
exist, Actions > Publish > Run workflow on `main` publishes the current
catalog without waiting for the next merge.

If the release key is ever replaced, put the new public key in
`catalog.pub` before changing the secrets here: the Sign job refuses a
secret key that does not match `catalog.pub`.

### License

The templates and the scripts are MIT licensed. By opening a pull request you
agree that your template is published under the same license. Logos keep their
own licenses: credit each one in NOTICE.
