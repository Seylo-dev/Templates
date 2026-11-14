# The template format

Each folder here is one template, in the same shape Easypanel uses. The
folder name is the slug: lower-case letters, digits and dashes, at most 60.

```
templates/<slug>/
  meta.yaml     the card, the install dialog and the install form
  index.ts      generate(input): the services to create
  logo.svg      optional; or logo.webp / logo.png
```

Nothing else goes in the folder. `bun run new <slug>` starts one from
[`example/`](../example), which uses every part described below.

The panel compiles `index.ts` and runs it in a QuickJS WebAssembly sandbox
with no network, files, timers or host objects, a 32 MiB memory cap and a
1 second time limit. What `generate` returns is checked against a schema
and shown to the user as a list of services before anything is created.

## meta.yaml

```yaml
name: "n8n"                      # at most 60 characters
description: "One line for the card."   # at most 140
category: "Automation"
tags: ["automation", "workflows"]       # at most 12
creates: "App + Postgres"        # shown on the card, at most 60
links:                           # at most 8, https only
  - label: "Docs"
    url: "https://docs.n8n.io"
minPanel: "0.2.17"               # optional, see below
body: |
  Markdown shown in the install dialog.
schema:                          # the install form (a JSON Schema subset)
  type: object
  required: ["image"]
  properties:
    image:
      type: "string"
      title: "Image"
      description: "Docker image and tag to run."
      default: "n8nio/n8n:1.80.0"
    adminPassword:
      type: "string"
      format: "password"         # generated when left empty
      title: "Admin password"
    plan:
      type: "string"
      enum: ["small", "large"]   # a select
```

No other keys are allowed. Categories: Analytics, Automation, CMS,
Communication, Databases, Developer tools, Marketing, Monitoring, Other,
Productivity, Search, Security, Storage. A new one is a warning, not an
error: say why in the pull request.

Form fields: `type` is `string`, `number`, `integer` or `boolean`;
`format: password` (generated when left empty) or `format: domain`; `enum`
makes a select. A field named `image` or ending in `Image` holds an image
and its default must be pinned (see Images). The panel always asks for the
service name and the node itself; `generate` gets the service name as
`input.serviceName` and the project's name as `input.projectName`, next to
the form's values.

### minPanel

The oldest Seylo version that can run the template, when it needs
something a newer panel added (a new service field, a new database
version). Leave it out otherwise. A panel older than `minPanel` does not
list the template and says how many templates need a newer Seylo. The
check fails when `minPanel` is newer than the panel it checks against
(`check` in [`panel.json`](../panel.json)), and the second CI check runs
against the oldest panel the catalog supports (`oldest`), so a template
that needs a newer panel without saying so fails there.

## index.ts

```ts
import { env, PRIMARY_DOMAIN, randomHex, ref } from "~templates-utils";

export function generate(input: { serviceName: string; image: string }) {
  const db = `${input.serviceName}-db`;
  return {
    services: [
      { type: "postgres", data: { serviceName: db, version: "17", database: "app" } },
      {
        type: "app",
        data: {
          serviceName: input.serviceName,
          source: { type: "image", image: input.image },
          env: env({ DATABASE_URL: ref(db, "INTERNAL_URL"), SECRET: randomHex(32) }),
          domains: [{ host: PRIMARY_DOMAIN, port: 3000 }],
          mounts: [{ type: "volume", name: "data", mountPath: "/data" }],
        },
      },
    ],
  };
}
```

Every service name must start with `input.serviceName`, so two installs in
one project do not clash.

Service types:

- `app`: an image with `env` (KEY=value lines), `domains` (`host`, `port`,
  optional `path`), `mounts` (a named `volume`, or a `file` with its
  `content`), extra `ports` the container listens on, and an optional
  `deploy.command`, which replaces the image's entrypoint and runs in
  `/bin/sh -c`.
- The databases `postgres`, `mysql`, `mariadb`, `mongo`, `redis`, `valkey`,
  `keydb`, `dragonfly` and `clickhouse`: `version`, `variant` (such as
  `pgvector` for `postgres`), `database`, `user`, `password`. They are
  created like any database on the panel, with web UI, shell and backups.

`~templates-utils` gives:

- `randomPassword(n)`, `randomString(n)`, `randomHex(bytes)`,
  `randomBase64(bytes)`: a new value for every install;
- `env({...})`: KEY=value lines, leaving out null and undefined values;
- `ref(service, VARIABLE)`: a `${{service.VARIABLE}}` reference the panel
  resolves on every deploy, so a reset database password reaches the app;
- `PRIMARY_DOMAIN`: the node's automatic domain.

Database services offer `INTERNAL_URL`, `INTERNAL_HOST`, `INTERNAL_PORT`,
`USER`, `PASSWORD` and `DATABASE` (`clickhouse` also `INTERNAL_HTTP_URL`
and `INTERNAL_HTTP_PORT`). Apps offer `URL`, `DOMAIN`, `DOMAINS` (every
domain host, primary first, comma separated; `${{service.DOMAINS[1]}}` is
the second) and `INTERNAL_URL`.

Editor types for `~templates-utils` are in
[`types/templates-utils.d.ts`](../types/templates-utils.d.ts); open the
repository root in your editor and `tsconfig.json` picks them up.

## Images

Pin every image to a version: `n8nio/n8n:1.80.0`, not `n8nio/n8n` or
`n8nio/n8n:latest`. The tags `latest`, `stable`, `main`, `nightly` and
`edge` are refused. A project that only publishes a moving tag can be
pinned by digest: `excalidraw/excalidraw:latest@sha256:<digest>` (say so in
`body`, as `excalidraw` does). Use the app's own image (its project's
Docker Hub or ghcr.io image), not a third-party rebuild.

## Logo

`logo.svg`, or `logo.webp` (or `logo.png`) when the app has no small SVG.
The card and the install dialog show it on a light tile; a template
without one shows its first letter. The panel serves it at
`/api/templates/<slug>/logo.svg` (or `.webp`, `.png`), never from a CDN:
panels may have no internet access.

Take it from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons)
(Apache-2.0) at the commit in [`NOTICE`](../NOTICE): `svg/<name>.svg` as it
is, or `png/<name>.png` resized to 128 px and saved as WebP when the SVG is
missing or embeds a large image. Pick the variant drawn for light
backgrounds (not `-light`). An SVG must stay under 50 KB and a raster under
30 KB; an SVG must not hold scripts, event handlers, `foreignObject`,
embedded images or external links. Add a line for the file to `NOTICE`. A
logo from anywhere else gets its own line there with its source and
license.
