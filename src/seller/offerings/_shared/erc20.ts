import { erc20Abi, type Address } from "viem";
import { getBaseClients, getChainClients } from "./evm.js";

function getClients(chainId?: number) {
  if (chainId) return getChainClients(chainId);
  return getBaseClients();
}

export async function getErc20Balance(token: Address, owner: Address, chainId?: number) {
  const { publicClient } = getClients(chainId);
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  }) as Promise<bigint>;
}

export async function getAllowance(token: Address, owner: Address, spender: Address, chainId?: number) {
  const { publicClient } = getClients(chainId);
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  }) as Promise<bigint>;
}

export async function ensureAllowanceExact(token: Address, spender: Address, amount: bigint, chainId?: number) {
  const { publicClient, walletClient, account } = getClients(chainId);

  const current = await getAllowance(token, account.address, spender, chainId);
  if (current >= amount) return { approved: false as const };

  const hash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return { approved: true as const, approveTxHash: hash };
}
