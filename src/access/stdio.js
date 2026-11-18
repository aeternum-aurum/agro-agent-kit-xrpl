// SPDX-License-Identifier: Apache-2.0
// Serves an MCP handler over stdio: one JSON-RPC message per line in, one per line out. Logs go to stderr only.
import readline from "node:readline";
export function serveStdio(handle, input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); return; }
    const r = handle(msg);
    if (r) output.write(JSON.stringify(r) + "\n");
  });
  return rl;
}
