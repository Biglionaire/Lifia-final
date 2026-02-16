import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { chainIdOf } from "../_shared/chains.js";
import { parseSwapCommand, type SwapRequest } from "../_shared/command.js";
import { parseUnitsDecimal } from "../_shared/amount.js";
import { getToken, getQuote } from "../_shared/lifi.js";

function isHexAddress(x: string) {
  return /^0x[a-fA-F0-9]{40}$/.test((x ?? "").trim());
}

function coerceRequest(req: any): SwapRequest {
  // 1) command string
  if (typeof req === "string") return parseSwapCommand(req);
  if (typeof req?.command === "string" && req.command.trim()) return parseSwapCommand(req.command);

  // 2) structured
  const amount = String(req?.amount ?? "").trim();
  const tokenIn = String(req?.tokenIn ?? "").trim();
  const tokenOut = String(req?.tokenOut ?? "").trim();
  const chain = String(req?.chain ?? "").trim();
  const receiver = String(req?.receiver ?? "").trim();
  const sender = req?.sender ? String(req.sender).trim() : undefined;
  const slippage = typeof req?.slippage === "number" ? req.slippage : undefined;

  if (!amount || !tokenIn || !tokenOut || !chain || !receiver) {
    throw new Error("Missing fields. Provide 'command' OR {amount, tokenIn, tokenOut, chain, receiver}.");
  }
  return { amount, tokenIn, tokenOut, chain, receiver, sender, slippage };
}

export function validateRequirements(request: any): ValidationResult {
  try {
    const r = coerceRequest(request);

    const chainId = chainIdOf(r.chain);
    if (!chainId) return { valid: false, reason: `Unsupported chain: ${r.chain}` };

    if (!isHexAddress(r.receiver)) return { valid: false, reason: "receiver must be a 0x address" };
    if (r.sender && !isHexAddress(r.sender)) return { valid: false, reason: "sender must be a 0x address" };

    if (r.tokenIn.toLowerCase() === r.tokenOut.toLowerCase()) {
      return { valid: false, reason: "tokenIn and tokenOut must be different" };
    }

    const n = Number(r.amount);
    if (!Number.isFinite(n) || n <= 0) return { valid: false, reason: "amount must be a positive number" };

    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? "Invalid request" };
  }
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const r = coerceRequest(request);

  const chainId = chainIdOf(r.chain)!;
  const sender = r.sender ?? r.receiver;
  const receiver = r.receiver;

  // Resolve tokens on the same chain via LI.FI
  const fromTokenInfo = await getToken(chainId, r.tokenIn);
  const toTokenInfo = await getToken(chainId, r.tokenOut);

  const fromAmountBI = parseUnitsDecimal(r.amount, fromTokenInfo.decimals);
  const fromAmount = fromAmountBI.toString();

  // Same-chain swap: fromChain === toChain
  const quote = await getQuote({
    fromChain: chainId,
    toChain: chainId,
    fromToken: fromTokenInfo.address,
    toToken: toTokenInfo.address,
    fromAmount,
    fromAddress: sender,
    toAddress: receiver,
    slippage: r.slippage,
  });

  const deliverable = {
    mode: "quote_only",
    input: {
      amountHuman: r.amount,
      chain: r.chain,
      sender,
      receiver,
      tokenIn: r.tokenIn,
      tokenOut: r.tokenOut,
    },
    resolved: {
      chainId,
      fromToken: fromTokenInfo,
      toToken: toTokenInfo,
      fromAmount,
    },
    lifi: {
      quoteId: quote.id,
      tool: quote.tool,
      estimate: quote.estimate,
      transactionRequest: quote.transactionRequest,
    },
    next: "Buyer should sign & broadcast transactionRequest on source chain.",
    notes: [
      "LI.FI quote includes transactionRequest ready to sign & send.",
      "If fromToken is ERC20, you may need to approve the spender (see quote.estimate.approvalAddress).",
    ],
  };

  return { deliverable: JSON.stringify(deliverable, null, 2) };
}
