"use client";

import { createConfig, http } from "wagmi";
import { bsc } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors: [injected()],
  transports: {
    [bsc.id]: http("https://bsc-dataseed.bnbchain.org"),
  },
  ssr: true,
});

export const CHAIN_ID = bsc.id;