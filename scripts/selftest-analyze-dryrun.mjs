#!/usr/bin/env node
/**
 * POST /api/analyze-score にダミー JPEG 6枚を送り dryRun で疎通確認する。
 * サーバーが落ちずに JSON を返すことを検証する。
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function tinyJpeg() {
  // 最小に近い有効 JPEG
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
    "base64",
  );
}

function buildForm() {
  const jpeg = tinyJpeg();
  const form = new FormData();
  const blob = new Blob([jpeg], { type: "image/jpeg" });
  for (const name of ["color", "red", "colorTop", "colorBottom", "redTop", "redBottom"]) {
    form.append(name, blob, `${name}.jpg`);
  }
  form.append("roster", JSON.stringify([]));
  form.append("matchMeta", JSON.stringify({ match_date: "2026-01-01", opponent: "dryrun" }));
  form.append("dryRun", "1");
  form.append("imageMeta", JSON.stringify({ approxBytes: jpeg.length * 6 }));
  return form;
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 404 || res.status === 200) return true;
    } catch {
      // retry
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const port = process.env.PORT || "3010";
  const base = `http://127.0.0.1:${port}`;
  console.log(`[selftest] starting next dev on ${base}`);

  const child = spawn("npx", ["next", "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port) },
  });

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
    child.kill("SIGTERM");
    throw new Error("dev server did not become ready");
  }

  console.log("[selftest] POST /api/analyze-score dryRun…");
  const res = await fetch(`${base}/api/analyze-score`, {
    method: "POST",
    body: buildForm(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    child.kill("SIGTERM");
    throw new Error(`non-JSON response HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  console.log("[selftest] response:", JSON.stringify(json, null, 2));

  const crashed =
    /ECONNRESET|FATAL|JavaScript heap out of memory|Segmentation fault/i.test(logs);
  if (crashed) {
    child.kill("SIGTERM");
    throw new Error("server log indicates crash");
  }
  if (!res.ok || !json.ok || !json.dryRun) {
    child.kill("SIGTERM");
    throw new Error(`unexpected response HTTP ${res.status}`);
  }

  // 連続2回送っても落ちないこと（2枚直列の近似）
  console.log("[selftest] second dryRun (serial page2 simulation)…");
  const res2 = await fetch(`${base}/api/analyze-score`, {
    method: "POST",
    body: buildForm(),
  });
  const json2 = await res2.json();
  if (!res2.ok || !json2.ok) {
    child.kill("SIGTERM");
    throw new Error("second request failed");
  }

  child.kill("SIGTERM");
  await sleep(500);
  console.log("[selftest] PASS — server stayed up and returned JSON twice");
}

main().catch((err) => {
  console.error("[selftest] FAIL", err);
  process.exit(1);
});
