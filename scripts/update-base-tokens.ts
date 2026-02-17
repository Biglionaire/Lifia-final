#!/usr/bin/env -S npx tsx
/**
 * update-base-tokens.ts
 * Fetches Base chain tokens from LiFi API and updates chains.ts
 * 
 * Usage: npx tsx scripts/update-base-tokens.ts
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const LIFI_API = "https://li.quest/v1/tokens";
const BASE_CHAIN_ID = 8453;
const CHAINS_FILE = path.resolve("src/seller/offerings/_shared/chains.ts");

interface LiFiToken {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
  coinKey?: string;
  priceUSD?: string;
  logoURI?: string;
}

interface LiFiResponse {
  tokens: {
    [chainId: string]: LiFiToken[];
  };
}

async function fetchBaseTokens(): Promise<LiFiToken[]> {
  console.log("⏳ Fetching Base chain tokens from LI.FI API...");

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  
  if (process.env.LIFI_API_KEY) {
    headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
    console.log("✓ Using LIFI_API_KEY from environment");
  }
  
  if (process.env.LIFI_INTEGRATOR) {
    headers["x-lifi-integrator"] = process.env.LIFI_INTEGRATOR;
  }

  const url = `${LIFI_API}?chains=${BASE_CHAIN_ID}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Error ${response.status}: ${response.statusText}`);
    console.error(body);
    throw new Error(`Failed to fetch LI.FI tokens: ${response.statusText}`);
  }

  const data: LiFiResponse = await response.json();
  const baseTokens = data.tokens[BASE_CHAIN_ID.toString()] || [];
  
  console.log(`✅ Fetched ${baseTokens.length} tokens for Base chain`);
  return baseTokens;
}

function sanitizeSymbol(symbol: string): string {
  // Replace invalid characters for JavaScript property names
  return symbol
    .replace(/\+/g, "PLUS")
    .replace(/\-/g, "_")
    .replace(/\./g, "_")
    .replace(/\s/g, "_")
    .toUpperCase();
}

function generateTokenEntries(tokens: LiFiToken[]): string {
  // Sort tokens by symbol for better readability
  const sortedTokens = [...tokens].sort((a, b) => 
    a.symbol.localeCompare(b.symbol)
  );

  const entries: string[] = [];
  const seen = new Set<string>();

  for (const token of sortedTokens) {
    const symbol = sanitizeSymbol(token.symbol);
    const address = token.address;
    
    // Skip duplicates
    if (seen.has(symbol)) {
      console.log(`⚠️  Skipping duplicate: ${symbol} (${token.symbol})`);
      continue;
    }
    seen.add(symbol);

    // Format: SYMBOL: "0xAddress",
    const originalSymbol = token.symbol;
    if (originalSymbol !== symbol) {
      entries.push(`    ${symbol}: "${address}", // Original: ${originalSymbol}`);
    } else {
      entries.push(`    ${symbol}: "${address}",`);
    }
  }

  return entries.join("\n");
}

async function updateChainsFile(tokens: LiFiToken[]): Promise<void> {
  console.log("\n⏳ Updating chains.ts file...");

  const chainsContent = fs.readFileSync(CHAINS_FILE, "utf-8");
  
  // Find the Base chain section (8453)
  const baseStartRegex = /8453:\s*\{/;
  const baseStartMatch = chainsContent.match(baseStartRegex);
  
  if (!baseStartMatch) {
    throw new Error("Could not find Base chain (8453) section in chains.ts");
  }

  const startIndex = baseStartMatch.index! + baseStartMatch[0].length;
  
  // Find the closing brace for the Base section
  let braceCount = 1;
  let endIndex = startIndex;
  
  for (let i = startIndex; i < chainsContent.length && braceCount > 0; i++) {
    if (chainsContent[i] === "{") braceCount++;
    if (chainsContent[i] === "}") braceCount--;
    if (braceCount === 0) {
      endIndex = i;
      break;
    }
  }

  // Generate new token entries
  const newTokenEntries = generateTokenEntries(tokens);
  
  // Build the new content
  const before = chainsContent.substring(0, startIndex);
  const after = chainsContent.substring(endIndex);
  
  const newContent = `${before}\n${newTokenEntries}\n  ${after}`;
  
  // Write back to file
  fs.writeFileSync(CHAINS_FILE, newContent, "utf-8");
  
  console.log(`✅ Updated ${CHAINS_FILE}`);
  console.log(`✅ Total tokens in Base chain: ${tokens.length}`);
}

async function main(): Promise<void> {
  try {
    const tokens = await fetchBaseTokens();
    
    if (tokens.length === 0) {
      console.warn("⚠️  No tokens found for Base chain");
      return;
    }

    // Save raw data for reference
    const dataDir = path.resolve("data");
    fs.mkdirSync(dataDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonFile = path.join(dataDir, `base_tokens_${timestamp}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(tokens, null, 2), "utf-8");
    console.log(`✅ Saved raw data to ${jsonFile}`);
    
    // Update chains.ts
    await updateChainsFile(tokens);
    
    console.log("\n🎉 Successfully updated Base chain tokens!");
    console.log("\nNext steps:");
    console.log("1. Review the changes in chains.ts");
    console.log("2. Test that imports work correctly");
    console.log("3. Commit the changes");
    
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
