#!/usr/bin/env -S npx tsx
/**
 * sync-lifi-tokens.ts
 * Fetches supported tokens from the LI.FI API and caches them locally.
 *
 * Usage:  npx tsx scripts/sync-lifi-tokens.ts
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const LIFI_API = "https://li.quest/v1/tokens";
const OUT_DIR = path.resolve("data");
const OUT_FILE = process.env.LIFI_TOKEN_CACHE_PATH
  ? path.resolve(process.env.LIFI_TOKEN_CACHE_PATH)
  : path.join(OUT_DIR, "lifi_tokens.json");

async function main(): Promise<void> {
  console.log("⏳ Fetching LI.FI token list...");

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (process.env.LIFI_API_KEY) {
    headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  }
  if (process.env.LIFI_INTEGRATOR) {
    headers["x-lifi-integrator"] = process.env.LIFI_INTEGRATOR;
  }

  const response = await fetch(LIFI_API, { headers });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Error ${response.status}: ${response.statusText} - ${body}`);
    throw new Error(`Failed to sync LI.FI tokens: ${response.statusText}`);
  }

  const data = await response.json();

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✅ Saved ${OUT_FILE}`);

  // Also save a timestamped copy
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const stampedFile = path.join(OUT_DIR, `lifi_tokens_${ts}.json`);
  fs.writeFileSync(stampedFile, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✅ Saved ${stampedFile}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

