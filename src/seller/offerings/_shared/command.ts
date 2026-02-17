export type BridgeRequest = {
  amount: string;
  token: string;
  fromChain: string;
  toChain: string;
  receiver: string;
  sender?: string;
  toToken?: string;
  slippage?: number;
};

export type SwapRequest = {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  chain: string;
  receiver: string;
  sender?: string;
  slippage?: number;
};

export type WrapRequest = {
  action: "wrap" | "unwrap";
  amount: string;
  chain: string;
  receiver: string;
  sender?: string;
};

export type AgentCommand =
  | { kind: "bridge"; amount: string; tokenIn: string; tokenOut: string; fromChain: string; toChain: string; receiver: string; sender?: string; slippage?: number; order?: string }
  | { kind: "swap"; amount: string; tokenIn: string; tokenOut: string; chain: string; receiver: string; sender?: string; slippage?: number; order?: string }
  | { kind: "wrap"; action: "wrap" | "unwrap"; amount: string; chain: string; receiver: string; sender?: string; order?: string };

function pick(m: RegExpMatchArray, name: string) {
  // @ts-ignore
  return (m?.groups?.[name] ?? "").trim();
}

export function parseBridgeCommand(text: string): BridgeRequest {
  const input = (text ?? "").trim();

  const re =
    /^(?<verb>bridge)\s+(?<amount>\d+(?:\.\d+)?)\s+(?<token>[A-Za-z0-9:_\.\-]+)\s+from\s+(?<fromChain>[A-Za-z0-9_\-]+)(?:\s+chain)?\s+to\s+(?<toChain>[A-Za-z0-9_\-]+)(?:\s+chain)?(?:\s+sender\s+(?<sender>0x[a-fA-F0-9]{40}))?(?:\s+receiver(?:\s+address)?\s+(?<receiver>0x[a-fA-F0-9]{40}))?(?:\s+toToken\s+(?<toToken>[A-Za-z0-9:_\.\-]+))?(?:\s+slippage\s+(?<slippage>\d+(?:\.\d+)?))?\s*$/i;

  const m = input.match(re);
  if (!m) throw new Error(`Unrecognized command. Example: bridge 5 USDC from base to arbitrum receiver 0x...`);

  const amount = pick(m, "amount");
  const token = pick(m, "token");
  const fromChain = pick(m, "fromChain");
  const toChain = pick(m, "toChain");
  const sender = pick(m, "sender") || undefined;
  const receiver = pick(m, "receiver") || "";
  const toToken = pick(m, "toToken") || undefined;
  const slippageStr = pick(m, "slippage");
  const slippage = slippageStr ? Number(slippageStr) : undefined;

  if (!receiver) throw new Error("Missing receiver. Example: ... receiver 0xabc...");
  return { amount, token, fromChain, toChain, receiver, sender, toToken, slippage };
}

export function parseSwapCommand(text: string): SwapRequest {
  const input = (text ?? "").trim();

  // supports:
  // swap 5 USDC to ETH on base receiver 0x...
  // swap 100 USDC to WETH on base sender 0x... receiver 0x... slippage 0.5
  const re =
    /^(?<verb>swap)\s+(?<amount>\d+(?:\.\d+)?)\s+(?<tokenIn>[A-Za-z0-9:_\.\-]+)\s+to\s+(?<tokenOut>[A-Za-z0-9:_\.\-]+)\s+on\s+(?<chain>[A-Za-z0-9_\-]+)(?:\s+chain)?(?:\s+sender\s+(?<sender>0x[a-fA-F0-9]{40}))?(?:\s+receiver(?:\s+address)?\s+(?<receiver>0x[a-fA-F0-9]{40}))?(?:\s+slippage\s+(?<slippage>\d+(?:\.\d+)?))?\s*$/i;

  const m = input.match(re);
  if (!m) throw new Error(`Unrecognized command. Example: swap 5 USDC to ETH on base receiver 0x...`);

  const amount = pick(m, "amount");
  const tokenIn = pick(m, "tokenIn");
  const tokenOut = pick(m, "tokenOut");
  const chain = pick(m, "chain");
  const sender = pick(m, "sender") || undefined;
  const receiver = pick(m, "receiver") || "";
  const slippageStr = pick(m, "slippage");
  const slippage = slippageStr ? Number(slippageStr) : undefined;

  if (!receiver) throw new Error("Missing receiver. Example: ... receiver 0xabc...");
  return { amount, tokenIn, tokenOut, chain, receiver, sender, slippage };
}

/**
 * Parse a wrap/unwrap command string.
 * - "wrap 5 ETH on base receiver 0x..."
 * - "unwrap 5 WETH on base receiver 0x..."
 */
export function parseWrapCommand(text: string): WrapRequest {
  const input = (text ?? "").trim();

  const re =
    /^(?<action>wrap|unwrap)\s+(?<amount>\d+(?:\.\d+)?)\s+(?:[A-Za-z0-9:_\.\-]+)\s+on\s+(?<chain>[A-Za-z0-9_\-]+)(?:\s+chain)?(?:\s+sender\s+(?<sender>0x[a-fA-F0-9]{40}))?(?:\s+receiver(?:\s+address)?\s+(?<receiver>0x[a-fA-F0-9]{40}))?\s*$/i;

  const m = input.match(re);
  if (!m) throw new Error(`Unrecognized command. Example: wrap 5 ETH on base receiver 0x...`);

  const action = pick(m, "action").toLowerCase() as "wrap" | "unwrap";
  const amount = pick(m, "amount");
  const chain = pick(m, "chain");
  const sender = pick(m, "sender") || undefined;
  const receiver = pick(m, "receiver") || "";

  if (!receiver) throw new Error("Missing receiver. Example: ... receiver 0xabc...");
  return { action, amount, chain, receiver, sender };
}

/**
 * Parse a generic agent command (swap, bridge, wrap, or unwrap).
 * - "swap 5 USDC to ETH on base receiver 0x..."
 * - "bridge 5 USDC from base to arbitrum receiver 0x..."
 * - "wrap 5 ETH on base receiver 0x..."
 * - "unwrap 5 WETH on base receiver 0x..."
 */
export function parseAgentCommand(text: string): AgentCommand {
  const input = (text ?? "").trim();
  const verb = input.split(/\s+/)[0]?.toLowerCase();

  if (verb === "swap") {
    const r = parseSwapCommand(input);
    return {
      kind: "swap",
      amount: r.amount,
      tokenIn: r.tokenIn,
      tokenOut: r.tokenOut,
      chain: r.chain,
      receiver: r.receiver,
      sender: r.sender,
      slippage: r.slippage,
    };
  }

  if (verb === "bridge") {
    const r = parseBridgeCommand(input);
    return {
      kind: "bridge",
      amount: r.amount,
      tokenIn: r.token,
      tokenOut: r.toToken ?? r.token,
      fromChain: r.fromChain,
      toChain: r.toChain,
      receiver: r.receiver,
      sender: r.sender,
      slippage: r.slippage,
    };
  }

  if (verb === "wrap" || verb === "unwrap") {
    const r = parseWrapCommand(input);
    return {
      kind: "wrap",
      action: r.action,
      amount: r.amount,
      chain: r.chain,
      receiver: r.receiver,
      sender: r.sender,
    };
  }

  throw new Error(`Unknown command verb: "${verb}". Supported: swap, bridge, wrap, unwrap.`);
}
