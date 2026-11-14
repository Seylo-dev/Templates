// Example template: App + Postgres. Runs in the panel's template sandbox; see templates/README.md.
//
// Copied from example/ by `bun run new`. Fill in each line marked as a todo
// (the check fails while one is left) and delete the comments you do not need.
//
// The panel compiles this file and runs generate() in a sandbox (no network,
// files or timers; 1 second, 32 MiB), checks what it returns and shows the
// services to the user before it creates anything.

import { env, PRIMARY_DOMAIN, randomHex, ref } from "~templates-utils";

// The form's values (schema.properties in meta.yaml), plus serviceName and
// projectName, which the panel always asks for.
interface Input {
  serviceName: string;
  projectName: string;
  image: string;
  adminEmail?: string;
  adminPassword: string; // a password field always arrives filled in: typed or generated
  logLevel: string;
}

export function generate(input: Input) {
  // Every service name starts with input.serviceName, so two installs in one project do not clash.
  const db = `${input.serviceName}-db`;
  return {
    services: [
      // A database the panel runs and manages like any other (web UI, shell, backups). The other
      // types: mysql, mariadb, mongo, redis, valkey, keydb, dragonfly and clickhouse.
      { type: "postgres", data: { serviceName: db, version: "17", database: "app" } }, // TODO: the database the app needs, or none
      {
        type: "app",
        data: {
          serviceName: input.serviceName,
          source: { type: "image", image: input.image },
          // KEY=value lines. ref() is resolved on every deploy, so a reset database password reaches the app.
          env: env({
            DATABASE_URL: ref(db, "INTERNAL_URL"), // TODO: the variables the app reads
            ADMIN_EMAIL: input.adminEmail,
            ADMIN_PASSWORD: input.adminPassword,
            LOG_LEVEL: input.logLevel,
            SECRET_KEY: randomHex(32), // a new random value for every install
            PUBLIC_URL: ref(input.serviceName, "URL"),
          }),
          // The node's automatic domain, to the port the app listens on inside the container.
          domains: [{ host: PRIMARY_DOMAIN, port: 8080 }], // TODO: the app's port
          // Anything the app must keep across deploys goes on a volume.
          mounts: [{ type: "volume", name: "data", mountPath: "/data" }], // TODO: where the app keeps its data
          // A config file:    mounts: [{ type: "file", content: "...", mountPath: "/etc/app/config.yml" }]
          // Another command:  deploy: { command: "app migrate && app serve" }  (replaces the entrypoint, runs in /bin/sh -c)
        },
      },
    ],
  };
}
