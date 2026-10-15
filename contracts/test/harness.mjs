/** a small in-process EVM harness: deploy, call and read contracts with viem's ABI coding over @ethereumjs/vm */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVM } from "@ethereumjs/vm";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { decodeErrorResult, decodeFunctionResult, encodeDeployData, encodeFunctionData } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const artifact = (name) => JSON.parse(readFileSync(join(root, "build", `${name}.json`), "utf8"));

/** deterministic test accounts: 0x…01, 0x…02 … */
export const acct = (n) => `0x${n.toString(16).padStart(40, "0")}`;

export async function chain() {
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Cancun }) });
  const run = async (from, to, data) => {
    const res = await vm.evm.runCall({ caller: createAddressFromString(from), to: to ? createAddressFromString(to) : undefined, data: hexToBytes(data), gasLimit: 30_000_000n });
    return res;
  };
  return {
    async deploy(name, args, from = acct(1)) {
      const { abi, bytecode } = artifact(name);
      const res = await run(from, undefined, encodeDeployData({ abi, bytecode, args }));
      if (res.execResult.exceptionError) throw new Error(`deploy ${name} failed: ${res.execResult.exceptionError.error}`);
      return contract(res.createdAddress.toString(), abi);
    },
  };

  function contract(address, abi) {
    return {
      address,
      /** state-changing call from `from`; resolves to the decoded result, rejects with the custom error name */
      async send(from, functionName, args = []) {
        const res = await run(from, address, encodeFunctionData({ abi, functionName, args }));
        const ret = bytesToHex(res.execResult.returnValue);
        if (res.execResult.exceptionError) {
          let reason = res.execResult.exceptionError.error;
          try {
            reason = decodeErrorResult({ abi, data: ret }).errorName;
          } catch {
            /* a revert string or an empty revert */
          }
          const e = new Error(reason);
          e.reason = reason;
          throw e;
        }
        return ret === "0x" ? undefined : decodeFunctionResult({ abi, functionName, data: ret });
      },
      read(functionName, args = []) {
        return this.send(acct(999), functionName, args);
      },
    };
  }
}
