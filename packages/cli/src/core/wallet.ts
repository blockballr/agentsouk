import { existsSync, readFileSync, statSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { CliError } from "./errors";

export interface LoadedSigner {
  address: `0x${string}`;
  // the viem account, for the two commands that send a transaction. it carries
  // the signer, never the raw key as a printable field.
  account: ReturnType<typeof privateKeyToAccount>;
  signMessage(message: string): Promise<`0x${string}`>;
}

// Read commands never touch this. A write command loads the key from the file
// the caller named, or from AGENTSOUK_KEY for CI, checks that the file is not
// readable by anyone else, and never puts the key in an error or a log line.
export function loadSigner(input: { keyFile?: string; env?: NodeJS.ProcessEnv }): LoadedSigner {
  const env = input.env ?? process.env;
  let raw = "";
  if (input.keyFile) {
    if (!existsSync(input.keyFile)) throw new CliError(`no key file at ${input.keyFile}`, "key_missing");
    if (process.platform !== "win32") {
      const mode = statSync(input.keyFile).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new CliError(`${input.keyFile} must be owner only (chmod 600 ${input.keyFile})`, "key_permissions");
      }
    }
    raw = readFileSync(input.keyFile, "utf8").trim();
  } else if (env.AGENTSOUK_KEY) {
    raw = env.AGENTSOUK_KEY.trim();
  } else {
    throw new CliError("this command signs: pass --key-file <path> or set AGENTSOUK_KEY", "key_missing");
  }

  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new CliError("the supplied key is not a 32 byte hex string", "key_invalid");
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  return {
    address: account.address,
    account,
    signMessage: (message) => account.signMessage({ message }),
  };
}
