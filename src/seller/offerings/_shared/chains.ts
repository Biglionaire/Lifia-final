import { mainnet, base, arbitrum, polygon, bsc } from "viem/chains";
import type { Chain } from "viem";

export type SupportedChain =
  | "ETHEREUM"
  | "BASE"
  | "ARBITRUM"
  | "POLYGON"
  | "BSC";

export const CHAIN_ID: Record<SupportedChain, number> = {
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  POLYGON: 137,
  BSC: 56,
};

const ALIASES: Record<string, SupportedChain> = {
  ethereum: "ETHEREUM",
  eth: "ETHEREUM",
  mainnet: "ETHEREUM",

  base: "BASE",

  arbitrum: "ARBITRUM",
  arb: "ARBITRUM",
  "arbitrum-one": "ARBITRUM",

  polygon: "POLYGON",
  pol: "POLYGON",
  matic: "POLYGON",

  bsc: "BSC",
  binance: "BSC",
  "binance-smart-chain": "BSC",
};

export function normalizeChain(input: string): SupportedChain | null {
  const key = (input ?? "").trim().toLowerCase();
  return ALIASES[key] ?? null;
}

export function chainIdOf(input: string): number | null {
  const c = normalizeChain(input);
  return c ? CHAIN_ID[c] : null;
}

// ---------------------------------------------------------------------------
// Viem chain objects (only chains we can execute transactions on)
// ---------------------------------------------------------------------------
export const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  137: polygon,
  56: bsc,
};

// ---------------------------------------------------------------------------
// RPC URLs — override via env vars, sensible public defaults otherwise
// ---------------------------------------------------------------------------
export function getRpcUrl(chainId: number): string {
  switch (chainId) {
    case 1:
      return process.env.ETH_RPC_URL?.trim() || "https://eth.llamarpc.com";
    case 8453:
      return process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org";
    case 42161:
      return process.env.ARB_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
    case 137:
      return process.env.POLYGON_RPC_URL?.trim() || "https://polygon-rpc.com";
    case 56:
      return process.env.BSC_RPC_URL?.trim() || "https://bsc-dataseed.binance.org";
    default:
      throw new Error(`No RPC URL configured for chainId ${chainId}`);
  }
}

// ---------------------------------------------------------------------------
// WETH / Wrapped-native-token addresses per chain
// ---------------------------------------------------------------------------
export const WETH_ADDRESS: Record<number, `0x${string}`> = {
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  8453: "0x4200000000000000000000000000000000000006",
  42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  137: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",  // WMATIC
  56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",   // WBNB
};

// ---------------------------------------------------------------------------
// Native token symbol per chain
// ---------------------------------------------------------------------------
export const NATIVE_TOKEN: Record<number, string> = {
  1: "ETH",
  8453: "ETH",
  42161: "ETH",
  137: "MATIC",
  56: "BNB",
};

// ---------------------------------------------------------------------------
// Common token addresses per chain (for synchronous lookups)
// ---------------------------------------------------------------------------
export const COMMON_TOKENS: Record<number, Record<string, `0x${string}`>> = {
  1: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  },
  8453: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH: "0x4200000000000000000000000000000000000006",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  },
  42161: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "USDC.e": "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  },
  137: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    "USDC.e": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
  },
  56: {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    DAI: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
  },
};

/**
 * Synchronous lookup for common token addresses.
 * Returns undefined when the token is not in the hardcoded table.
 */
export function getCommonTokenAddress(
  chainId: number,
  symbol: string,
): `0x${string}` | undefined {
  return COMMON_TOKENS[chainId]?.[symbol.toUpperCase()];
}
