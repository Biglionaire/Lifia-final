import "dotenv/config";
import {
  createPublicClient,
  http,
  parseUnits,
  getAddress,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, mainnet, arbitrum } from "viem/chains";

import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

/**
 * Supported chains (per offering description)
 */
type ChainKey = "base" | "eth" | "ethereum" | "mainnet" | "arb" | "arbitrum";

function normChain(x: any): ChainKey {
  return String(x ?? "").trim().toLowerCase() as ChainKey;
}

function chainFromKey(key: ChainKey) {
  switch (key) {
    case "base":
      return { chain: base, rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org" };
    case "eth":
    case "ethereum":
    case "mainnet":
      return { chain: mainnet, rpc: process.env.ETHEREUM_RPC_URL || mainnet.rpcUrls.default.http[0] };
    case "arb":
    case "arbitrum":
      return { chain: arbitrum, rpc: process.env.ARBITRUM_RPC_URL || arbitrum.rpcUrls.default.http[0] };
    default:
      throw new Error(`Unsupported chain: ${key}`);
  }
}

/**
 * WETH addresses per chain
 */
const WETH_BY_CHAINID: Record<number, `0x${string}`> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  8453: "0x4200000000000000000000000000000000000006",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
};

/**
 * USDC addresses (used for ACP requiredFunds flow)
 */
const USDC_BY_CHAINID: Record<number, `0x${string}`> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

function normalizeAmountHuman(x: any) {
  return String(x ?? "").trim().replace(",", ".");
}

function toNumberAmountSafe(x: string) {
  const n = Number(normalizeAmountHuman(x));
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

function pctToGross(net: number, feePct: number) {
  const denom = 1 - feePct;
  if (denom <= 0) return net;
  return Math.ceil((net / denom) * 1_000_000) / 1_000_000;
}

const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
] as const;

/**
 * IMPORTANT: must NOT throw (avoid unhandled rejection).
 */
export function validateRequirements(ctx: any): ValidationResult {
  try {
    const input = (ctx?.input ?? ctx?.job?.input ?? ctx ?? {}) as any;

    const amountHuman = normalizeAmountHuman(input.amountHuman ?? input.amount);
    const n = toNumberAmountSafe(amountHuman);
    if (!n) {
      return { valid: false, reason: 'Invalid amount. Example: "wrap 0.001 ETH on base"' };
    }

    const chainKey = normChain(input.chain ?? input.fromChain ?? "base");
    chainFromKey(chainKey);

    const token = String(input.token ?? input.asset ?? "ETH").trim().toUpperCase();
    if (token !== "ETH" && token !== "WETH") {
      return { valid: false, reason: `Unsupported token "${token}". Use ETH (wrap) or WETH (unwrap).` };
    }

    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? String(e) };
  }
}

/**
 * REQUIRED because offering.json has requiredFunds=true
 * Bridge-style SYNC return: { content, amount, tokenAddress, recipient, chainId }
 */
export function requestAdditionalFunds(request: any) {
  const pk = (process.env.EXECUTOR_PRIVATE_KEY || "").trim();
  if (!pk) throw new Error("Missing EXECUTOR_PRIVATE_KEY");
  const executor = privateKeyToAccount(pk as `0x${string}`).address;

  const input = (request?.input ?? request?.job?.input ?? request ?? {}) as any;
  const chainKey = normChain(input.chain ?? input.fromChain ?? "base");
  const { chain } = chainFromKey(chainKey);

  const tokenAddress = USDC_BY_CHAINID[chain.id];
  if (!tokenAddress) throw new Error(`USDC address not configured for chainId ${chain.id}`);

  // small default deposit grossed-up for 1% fee
  const net = 0.01;
  const gross = pctToGross(net, 0.01);

  return {
    content: `Please transfer ${gross} USDC to executor (includes 1% ACP job fee).`,
    amount: gross,
    tokenAddress,
    recipient: executor,
    chainId: chain.id,
  };
}

/**
 * Returns a tx request (deposit/withdraw on WETH).
 */
export async function executeJob(ctx: any): Promise<ExecuteJobResult> {
  const input = (ctx?.input ?? ctx?.job?.input ?? ctx ?? {}) as any;

  const amountHuman = normalizeAmountHuman(input.amountHuman ?? input.amount);
  const n = toNumberAmountSafe(amountHuman);
  if (!n) {
    return { deliverable: { type: "json", value: { ok: false, error: 'Invalid amount. Example: "wrap 0.001 ETH on base"' } } };
  }

  const chainKey = normChain(input.chain ?? input.fromChain ?? "base");
  const { chain, rpc } = chainFromKey(chainKey);

  const weth = WETH_BY_CHAINID[chain.id];
  if (!weth) {
    return { deliverable: { type: "json", value: { ok: false, error: `WETH not configured for chainId ${chain.id}` } } };
  }

  const token = String(input.token ?? input.asset ?? "ETH").trim().toUpperCase();
  const action = token === "WETH" ? "unwrap" : "wrap";

  const amountWei = parseUnits(amountHuman, 18);
  const data =
    action === "wrap"
      ? encodeFunctionData({ abi: wethAbi, functionName: "deposit", args: [] })
      : encodeFunctionData({ abi: wethAbi, functionName: "withdraw", args: [amountWei] });

  const tx = {
    chainId: chain.id,
    to: getAddress(weth),
    data,
    value: action === "wrap" ? amountWei.toString() : "0",
  };

  try {
    const publicClient = createPublicClient({ chain, transport: http(rpc) });
    await publicClient.getBytecode({ address: getAddress(weth) });
  } catch {
    // ignore
  }

  return {
    deliverable: {
      type: "json",
      value: {
        ok: true,
        mode: "txRequest",
        action,
        chain: chainKey,
        amountHuman,
        token,
        tx,
      },
    },
  };
}

