#!/usr/bin/env node
/**
 * Boot the built app against the *test* database, run a command against it, and
 * always shut the server down again.
 *
 * The app reads DATABASE_URL, so TEST_DATABASE_URL is mapped onto it here. That
 * keeps a stray test from ever touching real data — the two databases are
 * separate Neon projects.
 */
import { spawn } from "node:child_process";
import { config } from "dotenv";
import { existsSync } from "node:fs";

const PORT = Number(process.env.TEST_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;

// Local runs get their secrets from .env.local; CI injects them directly.
if (existsSync(".env.local")) config({ path: ".env.local", quiet: true });

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) {
  console.error("TEST_DATABASE_URL is not set — refusing to run tests.");
  process.exit(1);
}
if (!process.env.ADMIN_KEY) {
  console.error("ADMIN_KEY is not set — admin tests cannot run.");
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: testDb,
  TEST_BASE_URL: BASE,
  PORT: String(PORT),
  NODE_ENV: "production",
};

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 3000).unref();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early (${server.exitCode})\n${serverLog}`);
    }
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ready in ${timeoutMs}ms\n${serverLog}`);
}

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("usage: with-server.mjs <command> [args...]");
  process.exit(1);
}

try {
  await waitForServer();
  console.log(`▲ test server ready on ${BASE} (test database)`);
} catch (err) {
  console.error(String(err.message ?? err));
  shutdown(1);
}

const child = spawn(command[0], command.slice(1), { env, stdio: "inherit" });
child.on("exit", (code, signal) => shutdown(signal ? 1 : code ?? 1));
child.on("error", (err) => {
  console.error(err);
  shutdown(1);
});
