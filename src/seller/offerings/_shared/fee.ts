import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OfferingConfig {
  jobFee: number;
  jobFeeType: "fixed" | "percentage";
}

/**
 * Load offering configuration from offering.json
 * @param offeringName - Name of the offering (e.g., "swap", "bridge", "wrap")
 * @returns The offering configuration
 */
function loadOfferingConfig(offeringName: string): OfferingConfig {
  const offeringPath = path.resolve(__dirname, "..", offeringName, "offering.json");
  
  try {
    const configText = fs.readFileSync(offeringPath, "utf-8");
    return JSON.parse(configText);
  } catch (err: any) {
    throw new Error(
      `Failed to load offering config for "${offeringName}" at ${offeringPath}: ${err?.message ?? err}`
    );
  }
}

/**
 * Calculate the total amount to request from the buyer, including the job fee.
 * 
 * For percentage-based fees, the buyer transfers: amount + (amount * feePercentage)
 * For fixed fees, the buyer transfers: amount + fixedFee
 * 
 * This ensures the full requested amount is available for the operation after
 * the seller takes their fee.
 * 
 * @param amount - The base amount needed for the operation (e.g., swap amount)
 * @param offeringName - Name of the offering to load fee config from
 * @returns Total amount the buyer should transfer (amount + fee)
 */
export function calculateAmountWithFee(amount: number, offeringName: string): number {
  const config = loadOfferingConfig(offeringName);
  
  if (config.jobFeeType === "percentage") {
    // For percentage fee: buyer pays amount + (amount * feePercentage)
    // Example: 0.1 USDC with 1% fee = 0.1 + (0.1 * 0.01) = 0.101 USDC
    return amount + (amount * config.jobFee);
  } else {
    // For fixed fee: buyer pays amount + fixedFee
    // Example: 0.1 USDC with 5 USDC fixed fee = 0.1 + 5 = 5.1 USDC
    return amount + config.jobFee;
  }
}

/**
 * Format a number for display, removing excessive decimal places.
 * Uses up to 8 significant digits, which is appropriate for crypto amounts.
 * 
 * @param num - Number to format
 * @returns Formatted string representation
 */
export function formatAmount(num: number): string {
  // For very small numbers, use full precision
  if (num < 0.00000001) return num.toString();
  
  // For normal amounts, use toPrecision to get significant figures
  // then remove trailing zeros
  return parseFloat(num.toPrecision(8)).toString();
}
