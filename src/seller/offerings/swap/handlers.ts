import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { getAddress, erc20Abi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainClients } from "../_shared/evm.js";
import { chainIdOf, getCommonTokenAddress, VIEM_CHAINS, ACP_CHAIN_ID } from "../_shared/chains.js";
import { getToken, getQuote } from "../_shared/lifi.js";
import { parseSwapCommand, type SwapRequest } from "../_shared/command.js";
import { waitForSufficientBalance } from "../_shared/balance.js";
import { calculateAmountWithFee } from "../_shared/fee.js";

// ---------------------------------------------------------------------------
// Supported chains for executor-run swap
// ---------------------------------------------------------------------------
const SUPPORTED_CHAINS = ["base"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function env(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function toSlippageDecimal(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x ?? "");
  if (!Number.isFinite(n) || n <= 0) return 0.005;
  if (n > 1) return n / 100;
  if (n >= 0.1) return n / 100;
  return n;
}

function isHexAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
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

interface SwapParams {
  amountHuman: string;
  tokenIn: string;
  tokenOut: string;
  chain: string;
  receiver: string;
  slippage?: number;
  dryRun: boolean;
}

function coerceRequest(req: any): SwapParams {
  // Support command string
  if (typeof req === "string") {
    const r = parseSwapCommand(req);
    return { amountHuman: r.amount, tokenIn: r.tokenIn, tokenOut: r.tokenOut, chain: r.chain, receiver: r.receiver, slippage: r.slippage, dryRun: false };
  }
  if (typeof req?.command === "string" && req.command.trim()) {
    const r = parseSwapCommand(req.command);
    return { amountHuman: r.amount, tokenIn: r.tokenIn, tokenOut: r.tokenOut, chain: r.chain, receiver: r.receiver, slippage: r.slippage, dryRun: Boolean(req?.dryRun ?? false) };
  }

  // Structured request
  const amountHuman = String(req?.amountHuman ?? req?.amount ?? "").trim();
  const tokenIn = String(req?.tokenIn ?? "").trim();
  const tokenOut = String(req?.tokenOut ?? "").trim();
  const chain = String(req?.chain ?? "").trim();
  const receiver = String(req?.receiver ?? "").trim();
  const slippage = typeof req?.slippage === "number" ? req.slippage : undefined;
  const dryRun = Boolean(req?.dryRun ?? false);

  if (!amountHuman || !tokenIn || !tokenOut || !chain || !receiver) {
    throw new Error("Missing fields. Provide 'command' OR {amountHuman, tokenIn, tokenOut, chain, receiver}.");
  }
  return { amountHuman, tokenIn, tokenOut, chain, receiver, slippage, dryRun };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
export function validateRequirements(request: any): ValidationResult {
  try {
    const r = coerceRequest(request);

    const chainKey = r.chain.toLowerCase();
    if (!SUPPORTED_CHAINS.includes(chainKey)) {
      return { valid: false, reason: `Unsupported chain: ${r.chain}. Supported: ${SUPPORTED_CHAINS.join(", ")}` };
    }

    const chainId = chainIdOf(r.chain);
    if (!chainId) return { valid: false, reason: `Unsupported chain: ${r.chain}` };

    if (!isHexAddress(r.receiver)) return { valid: false, reason: "receiver must be a 0x address" };

    if (r.tokenIn.toLowerCase() === r.tokenOut.toLowerCase()) {
      return { valid: false, reason: "tokenIn and tokenOut must be different" };
    }

    const n = Number(r.amountHuman);
    if (!Number.isFinite(n) || n <= 0) return { valid: false, reason: "amountHuman must be a positive number" };

    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? "Invalid request" };
  }
}

// ---------------------------------------------------------------------------
// Payment request
// ---------------------------------------------------------------------------
export function requestPayment(req: any): string {
  try {
    const r = coerceRequest(req);
    return `To execute swap: please transfer ${r.amountHuman} ${r.tokenIn} on ${r.chain} to the executor wallet (ACP Funds Transfer). Then I will swap to ${r.tokenOut} and deliver to receiver=${r.receiver}.`;
  } catch {
    return "Swap request accepted.";
  }
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

  const r = coerceRequest(req);
  const amountNum = Number(r.amountHuman);
  const chainKey = r.chain.toLowerCase();
  
  // Calculate total amount including job fee
  // For percentage fee: amount + (amount * feePercentage)
  // This ensures the full swap amount is available after the seller takes their fee
  const totalAmount = calculateAmountWithFee(amountNum, "swap");
  
  // Always use Base chain for token address resolution since ACP operates on Base
  const tokenAddress = getCommonTokenAddress(ACP_CHAIN_ID, r.tokenIn);

  if (!tokenAddress) {
    throw new Error(`Token ${r.tokenIn} not found on Base chain. ACP only supports Base chain tokens.`);
  }

  return {
    content: `Send ${totalAmount} ${r.tokenIn} (${chainKey}) to executor=${recipient} so the swap can be executed. This includes ${r.amountHuman} ${r.tokenIn} for the swap plus the job fee.`,
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

    const r = coerceRequest(req);
    const chainKey = r.chain.toLowerCase();
    const receiver = getAddress(r.receiver);
    const slippage = toSlippageDecimal(r.slippage);

    const chainId = chainIdOf(chainKey);
    if (!chainId) {
      return { deliverable: { type: "json", value: { ok: false, error: `Unsupported chain=${chainKey}` } } };
    }

    if (!VIEM_CHAINS[chainId]) {
      return { deliverable: { type: "json", value: { ok: false, error: `Cannot execute on chainId=${chainId}` } } };
    }

    const { publicClient, walletClient, chain } = getChainClients(chainId);

    // Resolve tokens on the same chain via LI.FI
    const fromTokenInfo = await getToken(chainId, r.tokenIn);
    const toTokenInfo = await getToken(chainId, r.tokenOut);

    const fromAmount = parseUnits(r.amountHuman, Number(fromTokenInfo.decimals));

    // Check executor balance with polling for incoming ACP funds
    const isNative = fromTokenInfo.address === "0x0000000000000000000000000000000000000000";

    const balanceResult = await waitForSufficientBalance({
      publicClient,
      tokenAddress: fromTokenInfo.address,
      walletAddress: account.address,
      requiredAmount: fromAmount,
      isNative,
      label: "swap",
    });

    if (!balanceResult.ok) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: false,
            error: "Insufficient executor token balance",
            executor: account.address,
            chain: chainKey,
            chainId,
            tokenIn: r.tokenIn,
            needed: fromAmount.toString(),
            have: balanceResult.balance.toString(),
            hint: "Ensure the executor is funded on the source chain.",
          },
        },
      };
    }

    // Get LI.FI quote (same-chain swap)
    const quote = await getQuote({
      fromChain: chainId,
      toChain: chainId,
      fromToken: fromTokenInfo.address,
      toToken: toTokenInfo.address,
      fromAmount: fromAmount.toString(),
      fromAddress: account.address,
      toAddress: receiver,
      slippage,
      integrator: "lifi-api",
    });

    // Handle ERC-20 approvals (not needed for native tokens)
    let approvals: { approveTxs: string[]; allowanceReport: Record<string, string> } = {
      approveTxs: [],
      allowanceReport: {},
    };

    if (!isNative) {
      const spenders = extractSpenders(quote);
      const tokenAddr = getAddress(fromTokenInfo.address) as `0x${string}`;

      for (const sp of spenders) {
        const spender = getAddress(sp) as `0x${string}`;
        const allowance: bigint = await publicClient.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, spender],
        });
        approvals.allowanceReport[spender] = allowance.toString();

        if (allowance >= fromAmount) continue;

        const max = 2n ** 256n - 1n;
        const hash = await walletClient.writeContract({
          account,
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, max],
          chain,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        approvals.approveTxs.push(hash);
      }
    }

    const txReq = quote?.transactionRequest;
    if (!txReq?.to || !txReq?.data) {
      return { deliverable: { type: "json", value: { ok: false, error: "LI.FI quote missing transactionRequest" } } };
    }

    if (r.dryRun) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: true,
            mode: "dryRun",
            executor: account.address,
            input: { amountHuman: r.amountHuman, tokenIn: r.tokenIn, tokenOut: r.tokenOut, chain: chainKey, receiver, slippage },
            resolved: { chainId, fromToken: fromTokenInfo, toToken: toTokenInfo, fromAmount: fromAmount.toString() },
            approvals,
            lifi: { tool: quote?.tool, quoteId: quote?.id },
            quote,
          },
        },
      };
    }

    // Broadcast tx on chain
    const hash = await walletClient.sendTransaction({
      account,
      to: getAddress(txReq.to),
      data: txReq.data,
      value: BigInt(txReq.value ?? "0x0"),
      gas: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
      gasPrice: txReq.gasPrice ? BigInt(txReq.gasPrice) : undefined,
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
          input: { amountHuman: r.amountHuman, tokenIn: r.tokenIn, tokenOut: r.tokenOut, chain: chainKey, receiver, dryRun: false },
          resolved: { chainId, fromToken: fromTokenInfo, toToken: toTokenInfo, fromAmount: fromAmount.toString(), slippage },
          approvals,
          lifi: { tool: quote?.tool, quoteId: quote?.id },
          tx: {
            hash,
            status: receipt.status,
            blockNumber: receipt.blockNumber?.toString?.() ?? receipt.blockNumber,
          },
          note: "Same-chain swap confirmed.",
        },
      },
    };
  } catch (e: any) {
    const err = e?.response?.data ?? e?.message ?? e;
    return {
      deliverable: {
        type: "json",
        value: { ok: false, error: "Swap execution failed", details: typeof err === "object" ? JSON.stringify(err) : String(err) },
      },
    };
  }
}
