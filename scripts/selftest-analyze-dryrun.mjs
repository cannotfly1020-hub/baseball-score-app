#!/usr/bin/env node
/**
 * POST /api/analyze-score に約 800KB の application/json（Base64）を送り
 * dryRun で疎通確認する。FormData は使わない。
 * Failed to fetch / ECONNRESET なく JSON が返ることを検証する。
 *
 * 既存の next dev ロックを避けるため、ビルド済みアプリを next start で起動する。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 指定バイト数のダミー JPEG 風バイナリ → Base64（実デコード不要・サイズ検証用） */
function makePaddedBase64(targetBytes) {
  const header = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
    "base64",
  );
  const pad = Buffer.alloc(Math.max(0, targetBytes - header.length), 0x3f);
  return Buffer.concat([header, pad]).toString("base64");
}

function buildJsonBody(totalImageBytes = 800 * 1024) {
  const per = Math.floor(totalImageBytes / 6);
  const b64 = makePaddedBase64(per);
  const body = {
    colorImageBase64: b64,
    redImageBase64: b64,
    colorTopImageBase64: b64,
    colorBottomImageBase64: b64,
    redTopImageBase64: b64,
    redBottomImageBase64: b64,
    mimeType: "image/jpeg",
    roster: [],
    matchMeta: { match_date: "2026-01-01", opponent: "dryrun", pageHint: "single" },
    dryRun: true,
    imageMeta: {
      maxSide: 1400,
      jpegQuality: 0.76,
      approxBytes: totalImageBytes,
      pageHint: "single",
    },
  };
  const json = JSON.stringify(body);
  return { json, jsonBytes: Buffer.byteLength(json, "utf8") };
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/api/analyze-score`, {
        method: "GET",
        cache: "no-store",
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.ok) return true;
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  return false;
}

async function postDryRun(base, label) {
  const { json, jsonBytes } = buildJsonBody(800 * 1024);
  console.log(
    `[selftest] ${label}: POST JSON ${(jsonBytes / 1024).toFixed(1)}KB (~800KB images)…`,
  );
  let res;
  try {
    res = await fetch(`${base}/api/analyze-score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: json,
    });
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(
      `${label} Failed to fetch (${detail}). JSON ${(jsonBytes / 1024).toFixed(1)}KB`,
    );
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${label} non-JSON HTTP ${res.status} JSON=${(jsonBytes / 1024).toFixed(1)}KB: ${text.slice(0, 300)}`,
    );
  }
  if (!res.ok || !parsed.ok || !parsed.dryRun) {
    throw new Error(
      `${label} unexpected HTTP ${res.status} JSON=${(jsonBytes / 1024).toFixed(1)}KB: ${JSON.stringify(parsed)}`,
    );
  }
  console.log(
    `[selftest] ${label} ok bytesReceived=${parsed.bytesReceived} jsonKB=${(jsonBytes / 1024).toFixed(1)}`,
  );
  return { parsed, jsonBytes };
}

async function ensureBuild() {
  if (existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("[selftest] using existing .next build");
    return;
  }
  console.log("[selftest] running next build…");
  await new Promise((resolve, reject) => {
    const b = spawn("npx", ["next", "build"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    b.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`next build exited ${code}`)),
    );
  });
}

async function main() {
  const port = process.env.PORT || "3010";
  const base = `http://127.0.0.1:${port}`;
  await ensureBuild();

  console.log(`[selftest] starting next start on ${base}`);
  const child = spawn(
    "npx",
    ["next", "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(port) },
    },
  );

  let logs = "";
  child.stdout.on("data", (d) => {
    logs += d.toString();
    process.stdout.write(d);
  });
  child.stderr.on("data", (d) => {
    logs += d.toString();
    process.stderr.write(d);
  });

  const ready = await waitForServer(base);
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error("server did not become ready (GET /api/analyze-score)");
  }
  console.log("[selftest] health GET ok");

  await postDryRun(base, "page1");
  await postDryRun(base, "page2");

  const crashed =
    /ECONNRESET|FATAL|JavaScript heap out of memory|Segmentation fault/i.test(logs);
  if (crashed) {
    child.kill("SIGKILL");
    throw new Error("server log indicates crash / reset");
  }

  child.kill("SIGKILL");
  await sleep(300);
  console.log("[selftest] PASS — ~800KB JSON dryRun twice, no disconnect");
  process.exit(0);
}

main().catch((err) => {
  console.error("[selftest] FAIL", err);
  process.exit(1);
});
