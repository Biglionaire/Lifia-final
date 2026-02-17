import type { ExecuteJobResult, ValidationResult } from "../../runtime/offeringTypes.js";
import { getAddress, parseEther, formatEther, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainClients } from "../_shared/evm.js";
import { chainIdOf, WETH_ADDRESS, NATIVE_TOKEN, VIEM_CHAINS } from "../_shared/chains.js";
import { getQuote } from "../_shared/lifi.js";
import { parseWrapCommand, type WrapRequest } from "../_shared/command.js";

// ---------------------------------------------------------------------------
// WETH ABI (deposit = wrap, withdraw = unwrap)
// ---------------------------------------------------------------------------
const WETH_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
] as const;

// LI.FI uses zero address for native tokens
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

const SUPPORTED_CHAINS = ["base"];

// Wrapped native token symbol per chain
const WRAPPED_SYMBOL: Record<number, string> = {
  1: "WETH",
  8453: "WETH",
  42161: "WETH",
  137: "WMATIC",
  56: "WBNB",
};

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

function coerceRequest(req: any): { action: "wrap" | "unwrap"; amountHuman: string; chain: string; receiver: string; dryRun: boolean } {
  // Support command string
  if (typeof req === "string") {
    const r = parseWrapCommand(req);
    return { action: r.action, amountHuman: r.amount, chain: r.chain, receiver: r.receiver, dryRun: false };
  }
  if (typeof req?.command === "string" && req.command.trim()) {
    const r = parseWrapCommand(req.command);
    return { action: r.action, amountHuman: r.amount, chain: r.chain, receiver: r.receiver, dryRun: Boolean(req?.dryRun ?? false) };
  }

  // Structured request
  const action = String(req?.action ?? "").toLowerCase();
  if (action !== "wrap" && action !== "unwrap") {
    throw new Error("action must be 'wrap' or 'unwrap'");
  }
  return {
    action: action as "wrap" | "unwrap",
    amountHuman: String(req?.amountHuman ?? "").trim(),
    chain: String(req?.chain ?? "").trim(),
    receiver: String(req?.receiver ?? "").trim(),
    dryRun: Boolean(req?.dryRun ?? false),
  };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
export function validateRequirements(req: any): ValidationResult {
  try {
    const r = coerceRequest(req);

    if (!r.amountHuman || Number(r.amountHuman) <= 0) {
      return { valid: false, reason: "amountHuman must be a positive number" };
    }

    if (!SUPPORTED_CHAINS.includes(r.chain.toLowerCase())) {
      return { valid: false, reason: `Unsupported chain: ${r.chain}. Supported: ${SUPPORTED_CHAINS.join(", ")}` };
    }

    const chainId = chainIdOf(r.chain);
    if (!chainId || !WETH_ADDRESS[chainId]) {
      return { valid: false, reason: `No WETH address configured for chain: ${r.chain}` };
    }

    if (!isHexAddress(r.receiver)) {
      return { valid: false, reason: "receiver must be a valid 0x address" };
    }

    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: e?.message ?? "Invalid request" };
  }
}

// ---------------------------------------------------------------------------
// Request payment
// ---------------------------------------------------------------------------
export function requestPayment(req: any): string {
  try {
    const r = coerceRequest(req);
    const chainId = chainIdOf(r.chain)!;
    const nativeSymbol = NATIVE_TOKEN[chainId] ?? "ETH";
    const wrappedSymbol = WRAPPED_SYMBOL[chainId] ?? "WETH";
    if (r.action === "wrap") {
      return `To wrap: send ${r.amountHuman} ${nativeSymbol} (${r.chain}) to executor. Will return ${wrappedSymbol} to receiver=${r.receiver}.`;
    }
    return `To unwrap: send ${r.amountHuman} ${wrappedSymbol} (${r.chain}) to executor. Will return ${nativeSymbol} to receiver=${r.receiver}.`;
  } catch {
    return "Wrap/unwrap request accepted.";
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
  
  // Always use Base chain (8453) since ACP operates on Base
  const BASE_CHAIN_ID = 8453;
  const chainId = BASE_CHAIN_ID;
  const nativeSymbol = NATIVE_TOKEN[chainId] ?? "ETH";

  if (r.action === "wrap") {
    // For wrap action: use WETH address on Base instead of zero address
    // ACP needs a valid ERC-20 contract to call decimals() on
    const wethAddr = WETH_ADDRESS[chainId];
    return {
      content: `Send ${r.amountHuman} ${nativeSymbol} (${r.chain}) to executor=${recipient} for wrapping.`,
      amount: amountNum,
      tokenAddress: wethAddr,
      recipient,
    };
  }

  // For unwrap action: use WETH address (already correct)
  const wethAddr = WETH_ADDRESS[chainId];
  const wrappedSymbol = WRAPPED_SYMBOL[chainId] ?? "WETH";
  return {
    content: `Send ${r.amountHuman} ${wrappedSymbol} (${r.chain}) to executor=${recipient} for unwrapping.`,
    amount: amountNum,
    tokenAddress: wethAddr,
    recipient,
  };
}

// ---------------------------------------------------------------------------
// Execute — try LI.FI first, fallback to direct WETH contract
// ---------------------------------------------------------------------------
export async function executeJob(req: any): Promise<ExecuteJobResult> {
  try {
    const r = coerceRequest(req);
    const pk = env("EXECUTOR_PRIVATE_KEY");
    const account = privateKeyToAccount(pk as `0x${string}`);

    const chainId = chainIdOf(r.chain);
    if (!chainId) {
      return { deliverable: { type: "json", value: { ok: false, error: `Unsupported chain: ${r.chain}` } } };
    }
    if (!VIEM_CHAINS[chainId]) {
      return { deliverable: { type: "json", value: { ok: false, error: `Cannot execute on chain: ${r.chain}` } } };
    }

    const wethAddress = WETH_ADDRESS[chainId];
    if (!wethAddress) {
      return { deliverable: { type: "json", value: { ok: false, error: `No WETH configured for chain: ${r.chain}` } } };
    }

    const { publicClient, walletClient, chain } = getChainClients(chainId);
    const receiver = getAddress(r.receiver);
    const amountWei = parseEther(r.amountHuman);

    // Check balance
    if (r.action === "wrap") {
      const ethBalance = await publicClient.getBalance({ address: account.address });
      if (ethBalance < amountWei) {
        return {
          deliverable: {
            type: "json",
            value: {
              ok: false,
              error: "Insufficient native balance for wrap",
              executor: account.address,
              chain: r.chain,
              needed: amountWei.toString(),
              have: ethBalance.toString(),
            },
          },
        };
      }
    } else {
      const wethBalance: bigint = await publicClient.readContract({
        address: wethAddress,
        abi: WETH_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (wethBalance < amountWei) {
        return {
          deliverable: {
            type: "json",
            value: {
              ok: false,
              error: "Insufficient WETH balance for unwrap",
              executor: account.address,
              chain: r.chain,
              needed: amountWei.toString(),
              have: wethBalance.toString(),
            },
          },
        };
      }
    }

    if (r.dryRun) {
      return {
        deliverable: {
          type: "json",
          value: {
            ok: true,
            mode: "dryRun",
            action: r.action,
            executor: account.address,
            chain: r.chain,
            chainId,
            amountHuman: r.amountHuman,
            amountWei: amountWei.toString(),
            wethAddress,
            receiver,
          },
        },
      };
    }

    // --- Strategy 1: Try LI.FI swap (ETH <-> WETH on same chain) ---
    let lifiUsed = false;
    let txHash: string | undefined;

    try {
      const fromToken = r.action === "wrap" ? NATIVE_TOKEN_ADDRESS : wethAddress;
      const toToken = r.action === "wrap" ? wethAddress : NATIVE_TOKEN_ADDRESS;

      const quote = await getQuote({
        fromChain: chainId,
        toChain: chainId,
        fromToken,
        toToken,
        fromAmount: amountWei.toString(),
        fromAddress: account.address,
        toAddress: receiver,
        slippage: 0.001,
        integrator: "lifi-api",
      });

      const txReq = quote?.transactionRequest;
      if (txReq?.to && txReq?.data) {
        // LI.FI returned a valid transactionRequest — broadcast it
        txHash = await walletClient.sendTransaction({
          account,
          to: getAddress(txReq.to),
          data: txReq.data,
          value: BigInt(txReq.value ?? "0x0"),
          gas: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
          chain,
        });
        lifiUsed = true;
      }
    } catch (lifiErr: any) {
      // LI.FI failed — fall through to direct WETH contract
      console.log(`[wrap] LI.FI failed, falling back to direct WETH contract: ${lifiErr?.message ?? lifiErr}`);
    }

    // --- Strategy 2: Direct WETH contract (Uniswap-compatible fallback) ---
    if (!txHash) {
      if (r.action === "wrap") {
        // Step 1: WETH.deposit() — wraps ETH to WETH (credited to executor)
        txHash = await walletClient.writeContract({
          account,
          address: wethAddress,
          abi: WETH_ABI,
          functionName: "deposit",
          value: amountWei,
          chain,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

        // Step 2: If receiver != executor, transfer WETH to receiver
        if (receiver.toLowerCase() !== account.address.toLowerCase()) {
          const transferHash = await walletClient.writeContract({
            account,
            address: wethAddress,
            abi: WETH_ABI,
            functionName: "transfer",
            args: [receiver, amountWei],
            chain,
          });
          await publicClient.waitForTransactionReceipt({ hash: transferHash });
        }
      } else {
        // Step 1: WETH.withdraw() — unwraps WETH to ETH (credited to executor)
        txHash = await walletClient.writeContract({
          account,
          address: wethAddress,
          abi: WETH_ABI,
          functionName: "withdraw",
          args: [amountWei],
          chain,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

        // Step 2: If receiver != executor, send ETH to receiver
        if (receiver.toLowerCase() !== account.address.toLowerCase()) {
          const sendHash = await walletClient.sendTransaction({
            account,
            to: receiver,
            value: amountWei,
            chain,
          });
          await publicClient.waitForTransactionReceipt({ hash: sendHash });
        }
      }
    } else {
      // Wait for LI.FI tx
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    }

    const nativeSymbol = NATIVE_TOKEN[chainId] ?? "ETH";
    const wrappedSymbol = WRAPPED_SYMBOL[chainId] ?? "WETH";
    return {
      deliverable: {
        type: "json",
        value: {
          ok: true,
          mode: "executed",
          action: r.action,
          method: lifiUsed ? "lifi" : "weth_contract_direct",
          executor: account.address,
          chain: r.chain,
          chainId,
          amountHuman: r.amountHuman,
          amountWei: amountWei.toString(),
          wethAddress,
          receiver,
          txHash,
          description: r.action === "wrap"
            ? `Wrapped ${r.amountHuman} ${nativeSymbol} to ${wrappedSymbol} on ${r.chain}`
            : `Unwrapped ${r.amountHuman} ${wrappedSymbol} to ${nativeSymbol} on ${r.chain}`,
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
          error: "Wrap/unwrap execution failed",
          details: typeof err === "object" ? JSON.stringify(err) : String(err),
        },
      },
    };
  }
}
