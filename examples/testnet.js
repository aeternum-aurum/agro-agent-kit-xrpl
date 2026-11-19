// SPDX-License-Identifier: Apache-2.0
// The examples only talk to XRPL Testnet or Devnet. The library itself is network-agnostic; using it on Mainnet is your decision.
export const NETWORKS = Object.freeze({ testnet: "wss://s.altnet.rippletest.net:51233", devnet: "wss://s.devnet.rippletest.net:51233" });
export function exampleNetwork(name = process.env.KIT_XRPL_NETWORK ?? "testnet") {
  const url = NETWORKS[name];
  if (!url) throw new Error(`examples run only on ${Object.keys(NETWORKS).join(" or ")}`);
  return url;
}
// Module 5 (read-only): the Stellar and XDC test networks used by the examples
export const STELLAR_TESTNET = "https://horizon-testnet.stellar.org";
export const XDC_APOTHEM = Object.freeze({ rpc: "https://rpc.apothem.network", chainId: 51 });
