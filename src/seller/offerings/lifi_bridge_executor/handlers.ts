import axios from "axios";
import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Minimal ERC20 ABI
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
] as const;

const LIFI_API = "https://li.quest/v1";

const CHAIN_KEY_TO_ID: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  polygon: 137,
  bsc: 56,
};

function env(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function toSlippageDecimal(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x ?? "");
  if (!Number.isFinite(n) || n <= 0) return 0.005; // default 0.5%
  // If user passes 0.5 meaning 0.5%, treat as percent.
  if (n > 1) return n / 100;
  // If user passes 0.5 (<=1) we assume it's decimal (50%) — too big, so also treat as percent.
  if (n >= 0.1) return n / 100; // 0.5 -> 0.005
  return n; // e.g. 0.005
}

function isHexAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function mkHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (process.env.LIFI_API_KEY?.trim()) h["x-lifi-api-key"] = process.env.LIFI_API_KEY.trim();
  return h;
}

async function lifiToken(chainId: number, token: string) {
  // token can be symbol or address (LI.FI supports both for /token lookup)
  const r = await axios.get(`${LIFI_API}/token`, {
    params: { chain: chainId, token },
    headers: mkHeaders(),
    timeout: 60_000,
  });
  return r.data;
}

async function lifiQuote(params: Record<string, any>) {
  const r = await axios.get(`${LIFI_API}/quote`, {
    params,
    headers: mkHeaders(),
    timeout: 60_000,
  });
  return r.data;
}

function extractSpenders(quote: any): string[] {
  const s = new Set<string>();
  const add = (x: any) => {
    if (typeof x === "string" && isHexAddress(x)) s.add(x.toLowerCase());
  };

  add(quote?.estimate?.approvalAddress);

  const steps = Array.isArray(quote?.includedSteps) ? quote.includedSteps : [];
  for (const st of steps) add(st?.estimate?.approvalAddress);

  return [...s];
}

async function ensureApprovals(opts: {
  publicClient: any;
  walletClient: any;
  account: any;
  tokenAddress: `0x${string}`;
  spenders: string[];
  minAmount: bigint;
}) {
  const { publicClient, walletClient, account, tokenAddress, spenders, minAmount } = opts;

  const approveTxs: string[] = [];
  const allowanceReport: Record<string, string> = {};

  for (const sp of spenders) {
    const spender = getAddress(sp) as `0x${string}`;
    const allowance: bigint = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, spender],
    });
    allowanceReport[spender] = allowance.toString();

    if (allowance >= minAmount) continue;

    // Approve max uint256
    const max =
      2n ** 256n - 1n;

    const hash = await walletClient.writeContract({
      account,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, max],
      chain: base,
    });

    // Wait confirm (optional but safer)
    await publicClient.waitForTransactionReceipt({ hash });
    approveTxs.push(hash);
  }

  return { approveTxs, allowanceReport };
}

export function validateRequirements(req: any): ValidationResult {
  try {
    const amountHuman = String(req?.amountHuman ?? "").trim();
    const amountNum = Number(amountHuman);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return { valid: false, reason: "amountHuman must be a positive number string" };
    }

    const fromChain = String(req?.fromChain ?? "").toLowerCase();
    const toChain = String(req?.toChain ?? "").toLowerCase();
    const receiver = String(req?.receiver ?? "").trim();
    const token = String(req?.token ?? "USDC").toUpperCase();
    const toToken = String(req?.toToken ?? token).toUpperCase();

    if (fromChain !== "base") return { valid: false, reason: "MVP executor only supports fromChain=base" };
    if (!CHAIN_KEY_TO_ID[toChain]) return { valid: false, reason: `Unsupported toChain: ${toChain}` };
    if (!isHexAddress(receiver)) return { valid: false, reason: "receiver must be a valid 0x address" };

    // MVP guard (you can expand later using your token cache)
    if (token !== "USDC") return { valid: false, reason: "MVP supports token=USDC only" };
    if (toToken !== "USDC") {
      // allow cross-chain swap toToken later if you want; for MVP you can reject or allow.
      // We'll allow, because LI.FI is a DEX+bridge aggregator and will route it.
    }

    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? "Validation error" };
  }
}

export function requestPayment(req: any): string {
  const amountHuman = String(req?.amountHuman ?? "").trim();
  const token = String(req?.token ?? "USDC").toUpperCase();
  const toChain = String(req?.toChain ?? "").toLowerCase();
  const receiver = String(req?.receiver ?? "").trim();
  const note = req?.toToken ? ` (toToken=${String(req.toToken).toUpperCase()})` : "";
  return `To execute: please transfer ${amountHuman} ${token} on Base to the executor wallet (ACP Funds Transfer). Then I will bridge to ${toChain} receiver=${receiver}${note}.`;
}

export function requestAdditionalFunds(req: any): {
  content?: string;
  amount: number;
  tokenAddress: string;
  recipient: string;
} {
  // IMPORTANT: ACP expects amount as "human" number (NOT smallest units).
  // See seller docs template. :contentReference[oaicite:5]{index=5}
  const pk = env("EXECUTOR_PRIVATE_KEY");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const recipient = account.address;

  const amountHuman = Number(String(req?.amountHuman ?? "").trim());
  const token = String(req?.token ?? "USDC").toUpperCase();

  // MVP: Base USDC address (Circle native on Base)
  const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  const tokenAddress = token === "USDC" ? baseUsdc : baseUsdc;

  return {
    content: `Send ${amountHuman} ${token} (Base) to executor=${recipient} so the bridge can be executed.`,
    amount: amountHuman,
    tokenAddress,
    recipient,
  };
}

export async function executeJob(req: any): Promise<ExecuteJobResult> {
  // NEVER return undefined — runtime will pass result.deliverable to ACP. :contentReference[oaicite:6]{index=6}
  try {
    const pk = env("EXECUTOR_PRIVATE_KEY");
    const rpc = env("BASE_RPC_URL");
    const account = privateKeyToAccount(pk as `0x${string}`);

    const amountHuman = String(req?.amountHuman ?? "").trim();
    const token = String(req?.token ?? "USDC").toUpperCase();
    const toTokenSym = String(req?.toToken ?? token).toUpperCase();
    const toChainKey = String(req?.toChain ?? "").toLowerCase();
    const receiver = getAddress(String(req?.receiver ?? "").trim());
    const dryRun = Boolean(req?.dryRun ?? false);
    const slippage = toSlippageDecimal(req?.slippage);

    const fromChainId = CHAIN_KEY_TO_ID["base"];
    const toChainId = CHAIN_KEY_TO_ID[toChainKey];
    if (!toChainId) {
      return { deliverable: { type: "json", value: { ok: false, error: `Unsupported toChain=${toChainKey}` } } };
    }

    // Resolve token metadata via LI.FI (symbol -> address/decimals)
    const fromToken = await lifiToken(fromChainId, token);
    const toToken = await lifiToken(toChainId, toTokenSym);

    const fromAmount = parseUnits(amountHuman, Number(fromToken.decimals));

    const publicClient = createPublicClient({
      chain: base,
      transport: http(rpc),
    });

    const walletClient = createWalletClient({
      chain: base,
      transport: http(rpc),
    });

    // Check executor balance (must have received funds in ACP payment phase)
    const bal: bigint = await publicClient.readContract({
      address: getAddress(fromToken.address),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    if (bal < fromAmount) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: false,
            error: "Insufficient executor token balance",
            executor: account.address,
            needed: fromAmount.toString(),
            have: bal.toString(),
            hint: "Ensure ACP Funds Transfer sent the token to the executor (requestAdditionalFunds recipient).",
          },
        },
      };
    }

    // Get LI.FI quote (single-step quote returns transactionRequest ready to send) :contentReference[oaicite:7]{index=7}
    const quote = await lifiQuote({
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken: fromToken.address,
      toToken: toToken.address,
      fromAmount: fromAmount.toString(),
      fromAddress: account.address,
      toAddress: receiver,
      slippage,
      integrator: "lifi-api",
    });

    const spenders = extractSpenders(quote);

    // Approvals if needed
    const approvals = await ensureApprovals({
      publicClient,
      walletClient,
      account,
      tokenAddress: getAddress(fromToken.address),
      spenders,
      minAmount: fromAmount,
    });

    const txReq = quote?.transactionRequest;
    if (!txReq?.to || !txReq?.data) {
      return { deliverable: { type: "json", value: { ok: false, error: "LI.FI quote missing transactionRequest" } } };
    }

    if (dryRun) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: true,
            mode: "dryRun",
            executor: account.address,
            input: { amountHuman, token, toToken: toTokenSym, fromChain: "base", toChain: toChainKey, receiver, slippage },
            resolved: {
              fromChainId,
              toChainId,
              fromToken,
              toToken,
              fromAmount: fromAmount.toString(),
            },
            approvals,
            lifi: {
              tool: quote?.tool,
              quoteId: quote?.id,
            },
            quote,
          },
        },
      };
    }

    // Broadcast tx
    const hash = await walletClient.sendTransaction({
      account,
      to: getAddress(txReq.to),
      data: txReq.data,
      value: BigInt(txReq.value ?? "0x0"),
      // If LI.FI returns gas fields, you can pass them; otherwise wallet client estimates.
      gas: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
      gasPrice: txReq.gasPrice ? BigInt(txReq.gasPrice) : undefined,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      deliverable: {
        type: "json",
        value: {
          ok: receipt.status === "success",
          mode: "executed",
          executor: account.address,
          input: { amountHuman, token, toToken: toTokenSym, fromChain: "base", toChain: toChainKey, receiver, dryRun: false },
          resolved: {
            fromChainId,
            toChainId,
            fromToken,
            toToken,
            fromAmount: fromAmount.toString(),
            slippage,
          },
          approvals,
          lifi: {
            tool: quote?.tool,
            quoteId: quote?.id,
          },
          tx: {
            hash,
            status: receipt.status,
            blockNumber: receipt.blockNumber?.toString?.() ?? receipt.blockNumber,
          },
          note: "Source tx confirmed. Destination arrival can be delayed; track using LI.FI status endpoints or the bridge tool explorer.",
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
          details: err,
        },
      },
    };
  }
}
