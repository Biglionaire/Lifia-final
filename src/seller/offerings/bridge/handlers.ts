import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { getAddress, erc20Abi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainClients } from "../_shared/evm.js";
import { chainIdOf, getCommonTokenAddress, VIEM_CHAINS, ACP_CHAIN_ID } from "../_shared/chains.js";
import { getToken, getQuote } from "../_shared/lifi.js";
import { waitForSufficientBalance } from "../_shared/balance.js";

// ---------------------------------------------------------------------------
// Supported chains for executor-run bridge
// ---------------------------------------------------------------------------
const SUPPORTED_FROM_CHAINS = ["base"];
const SUPPORTED_TO_CHAINS = ["ethereum", "base", "arbitrum", "polygon", "bsc"];

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

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
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

    if (!SUPPORTED_FROM_CHAINS.includes(fromChain)) {
      return { valid: false, reason: `Unsupported fromChain: ${fromChain}. Supported: ${SUPPORTED_FROM_CHAINS.join(", ")}` };
    }
    if (!chainIdOf(toChain)) {
      return { valid: false, reason: `Unsupported toChain: ${toChain}` };
    }
    if (fromChain === toChain) {
      return { valid: false, reason: "fromChain and toChain must be different. Use swap for same-chain." };
    }
    if (!isHexAddress(receiver)) {
      return { valid: false, reason: "receiver must be a valid 0x address" };
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
  const amountHuman = String(req?.amountHuman ?? "").trim();
  const token = String(req?.token ?? "USDC").toUpperCase();
  const fromChain = String(req?.fromChain ?? "base").toLowerCase();
  const toChain = String(req?.toChain ?? "").toLowerCase();
  const receiver = String(req?.receiver ?? "").trim();
  const note = req?.toToken ? ` (toToken=${String(req.toToken).toUpperCase()})` : "";
  return `To execute: please transfer ${amountHuman} ${token} on ${fromChain} to the executor wallet (ACP Funds Transfer). Then I will bridge to ${toChain} receiver=${receiver}${note}.`;
}

// ---------------------------------------------------------------------------
// Request additional funds (synchronous — uses hardcoded token table)
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

  const amountHuman = Number(String(req?.amountHuman ?? "").trim());
  const token = String(req?.token ?? "USDC").toUpperCase();
  const fromChainKey = String(req?.fromChain ?? "base").toLowerCase();

  // Always use Base chain for token address resolution since ACP operates on Base
  // Look up token address from common-token table on Base
  const tokenAddress = getCommonTokenAddress(ACP_CHAIN_ID, token);

  if (!tokenAddress) {
    throw new Error(`Token ${token} not found on Base chain. ACP only supports Base chain tokens.`);
  }

  return {
    content: `Send ${amountHuman} ${token} (${fromChainKey}) to executor=${recipient} so the bridge can be executed.`,
    amount: amountHuman,
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

    const amountHuman = String(req?.amountHuman ?? "").trim();
    const token = String(req?.token ?? "USDC").toUpperCase();
    const toTokenSym = String(req?.toToken ?? token).toUpperCase();
    const fromChainKey = String(req?.fromChain ?? "base").toLowerCase();
    const toChainKey = String(req?.toChain ?? "").toLowerCase();
    const receiver = getAddress(String(req?.receiver ?? "").trim());
    const dryRun = Boolean(req?.dryRun ?? false);
    const slippage = toSlippageDecimal(req?.slippage);

    const fromChainId = chainIdOf(fromChainKey);
    const toChainId = chainIdOf(toChainKey);
    if (!fromChainId) {
      return { deliverable: { type: "json", value: { ok: false, error: `Unsupported fromChain=${fromChainKey}` } } };
    }
    if (!toChainId) {
      return { deliverable: { type: "json", value: { ok: false, error: `Unsupported toChain=${toChainKey}` } } };
    }

    if (!VIEM_CHAINS[fromChainId]) {
      return { deliverable: { type: "json", value: { ok: false, error: `Cannot execute on chainId=${fromChainId}. Executor supports: Ethereum, Base, Arbitrum, Polygon, BSC.` } } };
    }

    // Get chain clients for the source chain
    const { publicClient, walletClient, chain } = getChainClients(fromChainId);

    // Resolve token metadata via LI.FI
    const fromToken = await getToken(fromChainId, token);
    const toToken = await getToken(toChainId, toTokenSym);

    const fromAmount = parseUnits(amountHuman, Number(fromToken.decimals));

    // Check executor balance with polling for incoming ACP funds
    const isNative = fromToken.address === "0x0000000000000000000000000000000000000000";

    const balanceResult = await waitForSufficientBalance({
      publicClient,
      tokenAddress: fromToken.address,
      walletAddress: account.address,
      requiredAmount: fromAmount,
      isNative,
      label: "bridge",
    });

    if (!balanceResult.ok) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: false,
            error: "Insufficient executor token balance",
            executor: account.address,
            chain: fromChainKey,
            chainId: fromChainId,
            token,
            needed: fromAmount.toString(),
            have: balanceResult.balance.toString(),
            hint: "Ensure the executor is funded on the source chain.",
          },
        },
      };
    }

    // Get LI.FI quote
    const quote = await getQuote({
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

    // Handle ERC-20 approvals (not needed for native tokens)
    let approvals: { approveTxs: string[]; allowanceReport: Record<string, string> } = {
      approveTxs: [],
      allowanceReport: {},
    };

    if (!isNative) {
      const spenders = extractSpenders(quote);
      const tokenAddr = getAddress(fromToken.address) as `0x${string}`;

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

    if (dryRun) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: true,
            mode: "dryRun",
            executor: account.address,
            input: { amountHuman, token, toToken: toTokenSym, fromChain: fromChainKey, toChain: toChainKey, receiver, slippage },
            resolved: { fromChainId, toChainId, fromToken, toToken, fromAmount: fromAmount.toString() },
            approvals,
            lifi: { tool: quote?.tool, quoteId: quote?.id },
            quote,
          },
        },
      };
    }

    // Broadcast tx on source chain
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
          input: { amountHuman, token, toToken: toTokenSym, fromChain: fromChainKey, toChain: toChainKey, receiver, dryRun: false },
          resolved: { fromChainId, toChainId, fromToken, toToken, fromAmount: fromAmount.toString(), slippage },
          approvals,
          lifi: { tool: quote?.tool, quoteId: quote?.id },
          tx: {
            hash,
            status: receipt.status,
            blockNumber: receipt.blockNumber?.toString?.() ?? receipt.blockNumber,
          },
          note: "Source tx confirmed. Destination arrival can be delayed; track using LI.FI /status endpoint.",
        },
      },
    };
  } catch (e: any) {
    const err = e?.response?.data ?? e?.message ?? e;
    return {
      deliverable: {
        type: "json",
        value: { ok: false, error: "Execution failed", details: typeof err === "object" ? JSON.stringify(err) : String(err) },
      },
    };
  }
}
