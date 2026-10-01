// hub-app-update.ts: GET /api/app/latest and GET /apk, on an ephemeral port against a throwaway repository root.
//
// What used to go wrong: the download link was built from primaryBaseUrl() (the first non-internal IPv4 - on a PC
// with WSL, Hyper-V or a VPN that is an address the phone cannot reach), and /apk accepted the token only in the
// query string, which puts it in every URL, log and browser history. A current phone now builds the URL from the
// hub address it is already configured with, and sends the token as a Bearer header. Old phones keep working: the
// manifest still carries `url` (and its alias `downloadUrl`) with ?token=, and /apk still accepts it.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";

process.env.SCREEN_SYNC_TOKEN = "app-update-route-token";
process.env.SCREEN_SYNC_HOST = "127.0.0.1";
process.env.SCREEN_SYNC_PORT = "0"; // nothing here listens on it, but it must never be 3000

const { mountAppUpdateRoutes, requestBaseUrl } = await import("../hub-app-update.js");
const { isAuthorized } = await import("../config.js");

const TOKEN = "app-update-route-token";
const APK_BYTES = Buffer.from("PK-fake-apk-bytes-for-the-download-test");

const dirs: string[] = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A repository root holding a "built" sideload APK, its Gradle metadata and a pubspec, or (built=false) nothing. */
function repo(built: boolean, meta = { code: 32, name: "2.5.4" }): string {
  const root = mkdtempSync(path.join(tmpdir(), "screensync-hub-update-"));
  dirs.push(root);
  if (!built) return root;
  const apkDir = path.join(root, "build", "app", "outputs", "flutter-apk");
  const metaDir = path.join(root, "build", "app", "outputs", "apk", "sideload", "release");
  mkdirSync(apkDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(path.join(apkDir, "app-sideload-release.apk"), APK_BYTES);
  writeFileSync(path.join(metaDir, "output-metadata.json"), JSON.stringify({ elements: [{ versionCode: meta.code, versionName: meta.name, outputFile: "app-sideload-release.apk" }] }));
  writeFileSync(path.join(root, "pubspec.yaml"), `name: demo\nversion: ${meta.name}+${meta.code}\n`);
  return root;
}

/**
 * `remote` fakes the peer address the route sees. Every real connection here comes from 127.0.0.1, which the route
 * trusts, so without it the LAN-facing 401 path cannot be exercised (and a regression that opened the route to the LAN
 * would pass every test).
 */
async function serve(root: string, remote?: string) {
  const app = express();
  if (remote) {
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", { value: remote, configurable: true });
      next();
    });
  }
  mountAppUpdateRoutes(app, { root });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    port: (server.address() as AddressInfo).port,
    close: async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); },
  };
}

/** GET with an explicit Host header (fetch controls it; http.request does not). */
function getWithHost(port: number, urlPath: string, host: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { ...headers, Host: host } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const bearer = { Authorization: `Bearer ${TOKEN}` };

test("/apk: a Bearer header is enough, and the bytes are the APK", async () => {
  const hub = await serve(repo(true));
  try {
    const res = await fetch(`${hub.base}/apk`, { headers: bearer });
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), APK_BYTES);
    assert.match(res.headers.get("content-disposition") ?? "", /screensync\.apk/);
  } finally {
    await hub.close();
  }
});

test("/apk: the legacy ?token= query still works (browser downloads and older phones)", async () => {
  const hub = await serve(repo(true));
  try {
    const res = await fetch(`${hub.base}/apk?token=${encodeURIComponent(TOKEN)}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), APK_BYTES);
  } finally {
    await hub.close();
  }
});

test("/apk: no credentials, a wrong header, a wrong query, or a near-miss token are all refused", async () => {
  const hub = await serve(repo(true));
  try {
    const refused = [
      await fetch(`${hub.base}/apk`),
      await fetch(`${hub.base}/apk`, { headers: { Authorization: "Bearer wrong" } }),
      await fetch(`${hub.base}/apk`, { headers: { Authorization: TOKEN } }), // no "Bearer " scheme
      await fetch(`${hub.base}/apk`, { headers: { Authorization: `Bearer ${TOKEN}x` } }),
      await fetch(`${hub.base}/apk?token=wrong`),
      await fetch(`${hub.base}/apk?token=`),
      await fetch(`${hub.base}/apk?token=${TOKEN.slice(0, -1)}`),
    ];
    for (const res of refused) {
      assert.equal(res.status, 403);
      assert.doesNotMatch(await res.text(), /PK-fake-apk/, "a refusal never leaks the file");
    }
  } finally {
    await hub.close();
  }
});

test("/apk: either credential is accepted on its own; a wrong header does not veto a right query", async () => {
  const hub = await serve(repo(true));
  try {
    const res = await fetch(`${hub.base}/apk?token=${encodeURIComponent(TOKEN)}`, { headers: { Authorization: "Bearer wrong" } });
    assert.equal(res.status, 200, "a wrong header alone would be refused, the right query token carries it");
    await res.arrayBuffer();
  } finally {
    await hub.close();
  }
});

test("/apk: 404 (after auth) when no APK has been built", async () => {
  const hub = await serve(repo(false));
  try {
    assert.equal((await fetch(`${hub.base}/apk`, { headers: bearer })).status, 404);
    assert.equal((await fetch(`${hub.base}/apk`)).status, 403, "unauthenticated callers learn nothing about the build");
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: every old field survives, and apkPath + versionSource are added", async () => {
  const hub = await serve(repo(true, { code: 32, name: "2.5.4" }));
  try {
    const res = await fetch(`${hub.base}/api/app/latest?versionCode=31`, { headers: bearer });
    assert.equal(res.status, 200);
    const b = await res.json() as Record<string, unknown>;
    for (const field of ["success", "versionName", "versionCode", "sha256", "sizeBytes", "builtAt", "installedVersionCode", "updateAvailable", "url"]) {
      assert.ok(field in b, `existing field ${field} is still there`);
    }
    assert.equal(b.success, true);
    assert.equal(b.versionCode, 32);
    assert.equal(b.versionName, "2.5.4");
    assert.equal(b.versionSource, "apk-metadata");
    assert.equal(b.apkPath, "/apk");
    assert.equal(b.installedVersionCode, 31);
    assert.equal(b.updateAvailable, true);
    assert.equal(b.sizeBytes, APK_BYTES.length);
    assert.match(String(b.sha256), /^[0-9a-f]{64}$/);
    assert.equal(b.downloadUrl, b.url, "downloadUrl is the same link as url");
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: updateAvailable follows the installed versionCode; without one it is null", async () => {
  const hub = await serve(repo(true, { code: 32, name: "2.5.4" }));
  try {
    const at = async (q: string) => (await (await fetch(`${hub.base}/api/app/latest${q}`, { headers: bearer })).json()) as { updateAvailable: boolean | null; installedVersionCode: number | null };
    assert.equal((await at("?versionCode=32")).updateAvailable, false, "already on the advertised build");
    assert.equal((await at("?versionCode=33")).updateAvailable, false, "newer than advertised");
    assert.equal((await at("?versionCode=1")).updateAvailable, true);
    const none = await at("");
    assert.equal(none.updateAvailable, null);
    assert.equal(none.installedVersionCode, null);
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: the download link uses the address the caller reached the hub on, not a guessed LAN IP", async () => {
  const hub = await serve(repo(true));
  try {
    const viaLan = await getWithHost(hub.port, "/api/app/latest", "192.168.50.7:3000", bearer);
    assert.equal(viaLan.status, 200);
    const b = JSON.parse(viaLan.body) as { url: string; downloadUrl: string };
    assert.equal(b.url, `http://192.168.50.7:3000/apk?token=${TOKEN}`);
    assert.equal(b.downloadUrl, b.url);

    const viaName = JSON.parse((await getWithHost(hub.port, "/api/app/latest", "my-pc.local:3456", bearer)).body) as { url: string };
    assert.equal(viaName.url, `http://my-pc.local:3456/apk?token=${TOKEN}`);

    const viaV6 = JSON.parse((await getWithHost(hub.port, "/api/app/latest", "[fe80::1]:3000", bearer)).body) as { url: string };
    assert.equal(viaV6.url, `http://[fe80::1]:3000/apk?token=${TOKEN}`);

    // adb reverse / a tunnel: the phone reaches the hub as its own loopback, and that is the address that works.
    const viaLoop = JSON.parse((await getWithHost(hub.port, "/api/app/latest", "127.0.0.1:3000", bearer)).body) as { url: string };
    assert.equal(viaLoop.url, `http://127.0.0.1:3000/apk?token=${TOKEN}`);
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: a malformed Host header is never echoed into the link", async () => {
  const hub = await serve(repo(true));
  try {
    let reached = 0;
    for (const evil of ["evil.example/x?y=1", "a b", "host:port", "h@ost", "<script>"]) {
      const res = await getWithHost(hub.port, "/api/app/latest", evil, bearer).catch(() => null);
      if (!res || res.status !== 200) continue; // the HTTP parser may refuse it outright, which is fine
      reached += 1;
      const url = (JSON.parse(res.body) as { url: string }).url;
      assert.match(url, /^http:\/\/[^/]+:\d+\/apk\?token=/, `link stays well-formed for Host ${JSON.stringify(evil)}: ${url}`);
      assert.ok(!url.includes(evil), `Host ${JSON.stringify(evil)} is not reflected`);
    }
    assert.ok(reached >= 3, "Node's HTTP server hands odd Host values to the handler, so the fallback really ran");
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: 404 with a message when no APK has been built", async () => {
  const hub = await serve(repo(false));
  try {
    const res = await fetch(`${hub.base}/api/app/latest`, { headers: bearer });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { success: boolean }).success, false);
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: a loopback caller needs no token (as before); the Bearer header works too", async () => {
  const hub = await serve(repo(true));
  try {
    assert.equal((await fetch(`${hub.base}/api/app/latest`)).status, 200, "the test runs on 127.0.0.1, which is trusted");
    assert.equal((await fetch(`${hub.base}/api/app/latest`, { headers: { Authorization: "Bearer wrong" } })).status, 200);
  } finally {
    await hub.close();
  }
});

test("/api/app/latest: a LAN caller (not loopback) needs the token, and a refusal never echoes it", async () => {
  const hub = await serve(repo(true), "192.168.1.50");
  try {
    const refused = [
      await fetch(`${hub.base}/api/app/latest`),
      await fetch(`${hub.base}/api/app/latest`, { headers: { Authorization: "Bearer wrong" } }),
      await fetch(`${hub.base}/api/app/latest`, { headers: { Authorization: TOKEN } }), // no "Bearer " scheme
    ];
    for (const res of refused) {
      assert.equal(res.status, 401);
      const body = await res.text();
      assert.doesNotMatch(body, new RegExp(TOKEN), "a refusal never leaks the token");
      assert.doesNotMatch(body, /versionCode/, "nor the manifest");
    }
    const ok = await fetch(`${hub.base}/api/app/latest`, { headers: bearer });
    assert.equal(ok.status, 200, "the right Bearer token is what lets a LAN phone in");
    await ok.arrayBuffer();
  } finally {
    await hub.close();
  }
});

test("requestBaseUrl falls back to the hub's own guess only when the Host header is unusable", () => {
  const req = (host: string | undefined) => ({ get: (n: string) => (n.toLowerCase() === "host" ? host : undefined), protocol: "http" }) as never;
  assert.equal(requestBaseUrl(req("10.0.0.5:3000")), "http://10.0.0.5:3000");
  assert.match(requestBaseUrl(req(undefined)), /^http:\/\/[^/]+:\d+$/);
  assert.match(requestBaseUrl(req("bad host")), /^http:\/\/[^/ ]+:\d+$/);
});

// Equality semantics only: the constant-time property itself (config.ts hashes both sides before comparing) is not
// something a unit test can measure, so this deliberately makes no timing claim.
test("isAuthorized accepts only the exact Bearer header (any length, no throw)", () => {
  assert.equal(isAuthorized(`Bearer ${TOKEN}`), true);
  assert.equal(isAuthorized(undefined), false);
  assert.equal(isAuthorized(""), false);
  assert.equal(isAuthorized(TOKEN), false);
  assert.equal(isAuthorized(`bearer ${TOKEN}`), false);
  assert.equal(isAuthorized(`Bearer ${TOKEN} `), false);
  assert.equal(isAuthorized(`Bearer ${TOKEN.slice(0, -1)}`), false);
  assert.equal(isAuthorized(`Bearer ${"x".repeat(5000)}`), false, "any length, no throw");
});
