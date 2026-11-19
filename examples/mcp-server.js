// SPDX-License-Identifier: Apache-2.0
// Read-only MCP server over stdio for the example class records. Register it in any MCP client as a local command:
//   node examples/mcp-server.js
import fs from "node:fs";
import { createMcpHandler, toolsFromRecords } from "../src/access/index.js";
import { serveStdio } from "../src/access/stdio.js";
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const records = [read("./enso-record.json"), read("./rain-class-example.json")];
serveStdio(createMcpHandler({ name: "agro-class-oracle", version: "0.2.0", tools: toolsFromRecords(records) }));
