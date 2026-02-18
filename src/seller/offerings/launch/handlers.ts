import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { getAddress, erc20Abi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainClients } from "../_shared/evm.js";
import { ACP_CHAIN_ID, getCommonTokenAddress } from "../_shared/chains.js";
import { waitForSufficientBalance } from "../_shared/balance.js";
import { calculateAmountWithFee, formatAmount } from "../_shared/fee.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OFFERING_NAME = "launch";
const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function env(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function isHexAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function countDecimals(value: number): number {
  if (Math.floor(value) === value) return 0;
  const str = value.toString();
  const decimalIndex = str.indexOf(".");
  if (decimalIndex === -1) return 0;
  return str.length - decimalIndex - 1;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
export function validateRequirements(req: any): ValidationResult {
  try {
    const amount = Number(req?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { valid: false, reason: "amount must be a positive number" };
    }

    // Validate decimal precision for USDC (6 decimals)
    if (countDecimals(amount) > USDC_DECIMALS) {
      return { valid: false, reason: `amount cannot have more than ${USDC_DECIMALS} decimal places for USDC` };
    }

    const addressToTip = String(req?.addressToTip ?? "").trim();
    if (!isHexAddress(addressToTip)) {
      return { valid: false, reason: "addressToTip must be a valid 0x address" };
    }

    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? "Validation error" };
  }
}

// ---------------------------------------------------------------------------
// Payment request
// ---------------------------------------------------------------------------
export function requestPayment(req: any): string {
  const amount = Number(req?.amount ?? 0);
  const addressToTip = String(req?.addressToTip ?? "").trim();
  return `To execute launch: please transfer the required funds to the executor wallet (ACP Funds Transfer). Then I will send ${amount} USDC tip to ${addressToTip}.`;
}

// ---------------------------------------------------------------------------
// Request additional funds
// ---------------------------------------------------------------------------
export function requestAdditionalFunds(req: any): {
  content?: string;
  amount: number;
  tokenAddress: string;
  recipient: string;
} {
  const pk = env("EXECUTOR_PRIVATE_KEY");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const recipient = account.address;

  const amount = Number(req?.amount ?? 0);
  const addressToTip = String(req?.addressToTip ?? "").trim();

  // Calculate total amount including job fee (250 USDC fixed fee)
  const totalAmount = calculateAmountWithFee(amount, OFFERING_NAME);

  // USDC token address on Base chain
  const tokenAddress = getCommonTokenAddress(ACP_CHAIN_ID, "USDC");

  if (!tokenAddress) {
    throw new Error("USDC token not found on Base chain");
  }

  return {
    content: `Send ${formatAmount(totalAmount)} USDC (Base) to executor=${recipient} so the launch tip can be executed. This includes ${amount} USDC for the tip plus the job fee.`,
    amount: totalAmount,
    tokenAddress,
    recipient,
  };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------
export async function executeJob(req: any): Promise<ExecuteJobResult> {
  try {
    const pk = env("EXECUTOR_PRIVATE_KEY");
    const account = privateKeyToAccount(pk as `0x${string}`);

    const amount = Number(req?.amount ?? 0);
    const addressToTip = getAddress(String(req?.addressToTip ?? "").trim());

    // Calculate total amount including job fee
    const totalAmount = calculateAmountWithFee(amount, OFFERING_NAME);

    // Get chain clients for Base
    const { publicClient, walletClient, chain } = getChainClients(ACP_CHAIN_ID);

    // Resolve USDC token address on Base chain
    const usdcAddress = getCommonTokenAddress(ACP_CHAIN_ID, "USDC");
    if (!usdcAddress) {
      return {
        deliverable: {
          type: "json",
          value: { ok: false, error: "USDC token not found on Base chain" },
        },
      };
    }

    // Convert amounts to USDC smallest unit (6 decimals)
    const usdcAmount = parseUnits(amount.toString(), USDC_DECIMALS);
    const totalUsdcAmount = parseUnits(totalAmount.toString(), USDC_DECIMALS);

    // Check executor balance with polling for incoming ACP funds
    // We need the total amount (tip + fee) to be available
    const balanceResult = await waitForSufficientBalance({
      publicClient,
      tokenAddress: usdcAddress,
      walletAddress: account.address,
      requiredAmount: totalUsdcAmount,
      isNative: false,
      label: "launch",
    });

    if (!balanceResult.ok) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: false,
            error: "Insufficient executor USDC balance",
            executor: account.address,
            chain: "base",
            chainId: ACP_CHAIN_ID,
            token: "USDC",
            needed: totalUsdcAmount.toString(),
            have: balanceResult.balance.toString(),
            hint: "Ensure the executor is funded with USDC on Base chain.",
          },
        },
      };
    }

    // Send USDC to addressToTip using ERC-20 transfer
    const hash = await walletClient.writeContract({
      account,
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [addressToTip, usdcAmount],
      chain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      deliverable: {
        type: "json",
        value: {
          ok: receipt.status === "success",
          mode: "executed",
          executor: account.address,
          input: { amount, addressToTip },
          tx: {
            hash,
            status: receipt.status,
            blockNumber: receipt.blockNumber?.toString?.() ?? receipt.blockNumber,
          },
          note: `Successfully sent ${amount} USDC tip to ${addressToTip}`,
        },
      },
    };
  } catch (e: any) {
    const err = e?.response?.data ?? e?.message ?? e;
    return {
      deliverable: {
        type: "json",
        value: {
          ok: false,
          error: "Execution failed",
          details: typeof err === "object" ? JSON.stringify(err) : String(err),
        },
      },
    };
  }
}
