# Seylo templates

One-click app templates for [Seylo](https://seylo.dev). Each folder under
[`templates/`](templates) is one app: `meta.yaml` (its card and install
form), `index.ts` (the services it creates) and its logo.

Every merge to `main` publishes a signed catalog of all templates. Seylo
panels check for a new one every 6 hours and on "Check for new templates"
on the Templates page, so a new template reaches panels without a Seylo
release. A panel without internet access uses the copy its release ships.

## Add a template

You need [Bun](https://bun.sh) (1.4.4 or newer) and git. Nothing else to
set up: the first check downloads the panel code it runs into `.cache/`.

```sh
bun run new my-app       # starts templates/my-app/ from example/
# fill in templates/my-app/meta.yaml and index.ts (each TODO),
# add logo.svg and its line in NOTICE
bun run check my-app     # the check every pull request runs
```

Then open a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) has the
details and what reviewers look for; the file format is in
[templates/README.md](templates/README.md).

Want an app but not up for writing it?
[Request a template](https://github.com/Seylo-dev/Templates/issues/new?template=request-template.yml).

## How panels get the catalog

The catalog is one JSON file with every template's files and their sha256,
and its [minisign](https://jedisct1.github.io/minisign/) signature, on the
rolling [`catalog` release](https://github.com/Seylo-dev/Templates/releases/tag/catalog):

```
https://github.com/Seylo-dev/Templates/releases/download/catalog/catalog.json
https://github.com/Seylo-dev/Templates/releases/download/catalog/catalog.json.minisig
```

A panel takes a downloaded catalog only when the signature verifies with
the catalog key built into it (the same key as [`catalog.pub`](catalog.pub)),
every file matches its sha256, and its sequence number is not lower than
one it already has; otherwise it keeps the catalog it has and shows why.
Template code runs in the panel's sandbox, and the panel shows the services
a template creates before it creates them.

`panel.json` names the [Seylo-dev/App](https://github.com/Seylo-dev/App)
version the check runs: `check` for every check and `oldest` for the oldest
panel the catalog supports. Until Seylo 0.2.17 is released both name the
App commit that added the check; at that release they become `v0.2.17`.

## License

[MIT](LICENSE) for the templates and the scripts. The logos are trademarks of their owners,
copied from dashboard-icons under the Apache License 2.0: see
[NOTICE](NOTICE) and [LICENSE.dashboard-icons](LICENSE.dashboard-icons).
