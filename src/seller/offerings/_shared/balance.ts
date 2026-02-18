import { getAddress, erc20Abi } from "viem";
import type { PublicClient } from "viem";

/**
 * Wait for sufficient balance with polling mechanism.
 * 
 * This function polls the blockchain to check if the executor wallet has
 * received sufficient funds. This is necessary because ACP fund transfers
 * may not have settled on-chain when executeJob() is first called.
 * 
 * @param opts Configuration options
 * @param opts.publicClient - Viem public client for reading blockchain state
 * @param opts.tokenAddress - Token contract address (or zero address for native)
 * @param opts.walletAddress - Executor wallet address to check balance of
 * @param opts.requiredAmount - Minimum balance required (in wei/smallest unit)
 * @param opts.isNative - True if checking native token balance (ETH, etc.)
 * @param opts.label - Label for logging (e.g., "swap", "bridge", "wrap")
 * @param opts.maxWaitMs - Maximum time to wait in milliseconds (default: 60000)
 * @param opts.pollIntervalMs - Time between polls in milliseconds (default: 5000)
 * @returns Object with ok status and final balance
 */
export async function waitForSufficientBalance(opts: {
  publicClient: PublicClient;
  tokenAddress: string;
  walletAddress: string;
  requiredAmount: bigint;
  isNative: boolean;
  label: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<{ ok: boolean; balance: bigint }> {
  const {
    publicClient,
    tokenAddress,
    walletAddress,
    requiredAmount,
    isNative,
    label,
    maxWaitMs = 60_000,
    pollIntervalMs = 5_000,
  } = opts;

  const startTime = Date.now();
  const maxAttempts = Math.ceil(maxWaitMs / pollIntervalMs);
  let attempt = 0;

  // Helper to get balance
  const getBalance = async (): Promise<bigint> => {
    if (isNative) {
      return await publicClient.getBalance({ address: walletAddress as `0x${string}` });
    } else {
      return await publicClient.readContract({
        address: getAddress(tokenAddress),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [walletAddress as `0x${string}`],
      });
    }
  };

  // Initial balance check
  let balance = await getBalance();

  // If balance is already sufficient, return immediately
  if (balance >= requiredAmount) {
    return { ok: true, balance };
  }

  // Balance is insufficient - start polling
  console.log(
    `[${label}] Executor balance insufficient (have=${balance.toString()}, need=${requiredAmount.toString()}). ` +
    `Waiting for ACP fund transfer to settle...`
  );

  // Poll for balance
  while (attempt < maxAttempts) {
    attempt++;
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    
    // Check balance again
    balance = await getBalance();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[${label}] Poll attempt ${attempt}/${maxAttempts} (${elapsed}s elapsed) — ` +
      `balance: ${balance.toString()} / ${requiredAmount.toString()} needed`
    );

    // Check if we now have sufficient balance
    if (balance >= requiredAmount) {
      console.log(`[${label}] Funds received! Balance now: ${balance.toString()}`);
      return { ok: true, balance };
    }
  }

  // Timeout - balance still insufficient
  const totalWaitSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[${label}] Timeout waiting for funds after ${totalWaitSec}s. ` +
    `Balance: ${balance.toString()}, needed: ${requiredAmount.toString()}`
  );

  return { ok: false, balance };
}
