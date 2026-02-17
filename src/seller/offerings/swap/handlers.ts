import axios from "axios";
import { encodeFunctionData, parseUnits } from "viem";

const LIFI_BASE = "https://li.quest/v1";

type ChainKey = "eth" | "base" | "arbitrum";
function normChain(s: string): ChainKey {
  const x = (s || "").toLowerCase().trim();
  if (["eth", "ethereum", "mainnet"].includes(x)) return "eth";
  if (["base"].includes(x)) return "base";
  if (["arb", "arbitrum"].includes(x)) return "arbitrum";
  throw new Error(`Unsupported chain "${s}". Supported: base, eth, arbitrum`);
}

function chainIdOf(k: ChainKey): number {
  switch (k) {
    case "eth": return 1;
    case "base": return 8453;
    case "arbitrum": return 42161;
  }
}

function parseHumanAmount(x: string): string {
  return (x || "").trim().replace(",", ".");
}

async function lifiToken(chainId: number, token: string) {
  const apiKey = process.env.LIFI_API_KEY;
  const res = await axios.get(`${LIFI_BASE}/token`, {
    params: { chain: chainId, token },
    headers: apiKey ? { "x-lifi-api-key": apiKey } : undefined,
    timeout: 30_000,
  });
  return res.data;
}

const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;

export async function validateRequirements(ctx: any) {
  try {
    const input = ctx?.input ?? ctx?.job?.input ?? ctx ?? {};
    const chainKey = normalizeChain(input.chain || input.fromChain || "base");

    const amountHuman = parseHumanAmount(String(input.amountHuman ?? input.amount ?? ""));
    if (!amountHuman || Number(amountHuman) <= 0) {
      return { valid: false, reason: 'Invalid amount. Example: swap 3 USDC to ETH' };
    }

    const fromSymbol = String(input.token ?? input.fromToken ?? "").toUpperCase().trim();
    const toSymbol = String(input.toToken ?? input.outToken ?? "").toUpperCase().trim();
    if (!fromSymbol || !toSymbol) {
      return { valid: false, reason: 'Missing token/toToken. Example: "swap 3 USDC to ETH"' };
    }

    const chainId = chainIdOf(chainKey);

    const fromTok = await lifiToken(chainId, fromSymbol);
    if (isNativeTokenAddress(fromTok.address)) {
      return {
        valid: false,
        reason:
          `Native token "${fromSymbol}" is not supported for ACP fund requests (tokenAddress=0x000.. causes decimals() failure). ` +
          `Please use wrapped token instead. For ETH chains use WETH, e.g. "wrap 0.001 ETH on ${chainKey}" then "swap 0.001 WETH to ${toSymbol}".`
      };
    }

    return true;
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? String(e) };
  }
}

export async function executeJob(ctx: any) {
  const input = ctx?.input ?? ctx?.job?.input ?? ctx ?? {};
  const chainKey = normChain(input.chain || input.onChain || "base");
  const chainId = chainIdOf(chainKey);

  const amountHuman = parseHumanAmount(String(input.amountHuman ?? input.amount ?? ""));
  const mode = String(input.mode || input.action || "wrap").toLowerCase().trim();

  // resolve WETH on that chain via LI.FI token registry
  const weth = await lifiToken(chainId, "WETH");
  const raw = parseUnits(amountHuman, 18);

  if (mode === "wrap") {
    // ETH -> WETH: call deposit() with value
    const data = encodeFunctionData({ abi: wethAbi, functionName: "deposit", args: [] });
    return {
      type: "json",
      value: {
        ok: true,
        mode: "client-sign",
        action: "wrap",
        chain: chainKey,
        chainId,
        token: "ETH",
        toToken: "WETH",
        amountHuman,
        amountRaw: raw.toString(),
        transactionRequest: {
          to: weth.address,
          data,
          value: raw.toString(),
        },
        note: "Sign this transaction from your Butler/AA wallet to wrap ETH -> WETH, then you can swap WETH -> ERC20.",
      },
    };
  }

  // unwrap WETH -> ETH
  const data = encodeFunctionData({ abi: wethAbi, functionName: "withdraw", args: [raw] });
  return {
    type: "json",
    value: {
      ok: true,
      mode: "client-sign",
      action: "unwrap",
      chain: chainKey,
      chainId,
      token: "WETH",
      toToken: "ETH",
      amountHuman,
      amountRaw: raw.toString(),
      transactionRequest: {
        to: weth.address,
        data,
        value: "0",
      },
      note: "Sign this transaction from your Butler/AA wallet to unwrap WETH -> ETH.",
    },
  };
}
