import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { VIEM_CHAINS, getRpcUrl } from "./chains.js";

export const BASE_RPC_URL = process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";

export function requireExecutorAccount() {
  const pk = process.env.EXECUTOR_PRIVATE_KEY?.trim();
  if (!pk) throw new Error("Missing EXECUTOR_PRIVATE_KEY in .env");
  return privateKeyToAccount(pk as Hex);
}

export function getBaseClients() {
  const account = requireExecutorAccount();
  const transport = http(BASE_RPC_URL, { timeout: 30_000 });

  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ chain: base, transport, account });

  return { publicClient, walletClient, account };
}

/**
 * Create viem public + wallet clients for any supported chain.
 * Supported: Ethereum (1), Base (8453), Arbitrum (42161).
 */
export function getChainClients(chainId: number) {
  const chain = VIEM_CHAINS[chainId];
  if (!chain) throw new Error(`No viem chain config for chainId ${chainId}. Supported: 1, 8453, 42161`);

  const account = requireExecutorAccount();
  const rpcUrl = getRpcUrl(chainId);
  const transport = http(rpcUrl, { timeout: 30_000 });

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  return { publicClient, walletClient, account, chain };
}
