"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClient = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const ui_1 = require("./ui");
class MCPClient {
    serverCommand;
    serverArgs;
    env;
    client = null;
    transport = null;
    constructor(serverCommand, serverArgs = [], env = {}) {
        this.serverCommand = serverCommand;
        this.serverArgs = serverArgs;
        this.env = env;
    }
    async connect() {
        try {
            const filteredEnv = Object.fromEntries(Object.entries({ ...process.env, ...this.env }).filter(([_, value]) => value !== undefined));
            this.transport = new stdio_js_1.StdioClientTransport({
                command: this.serverCommand,
                args: this.serverArgs,
                env: filteredEnv,
            });
            this.client = new index_js_1.Client({
                name: "cover-mcp-client",
                version: "1.0.0",
            }, {
                capabilities: {},
            });
            await this.client.connect(this.transport);
            ui_1.logger.info(`Connected to MCP server: ${this.serverCommand}`);
            return true;
        }
        catch (error) {
            ui_1.logger.error(`Failed to connect to MCP server: ${error.message}`);
            return false;
        }
    }
    async callTool(name, args) {
        if (!this.client) {
            throw new Error("MCP client not connected");
        }
        try {
            const result = await this.client.callTool({
                name,
                arguments: args,
            });
            return result;
        }
        catch (error) {
            ui_1.logger.error(`MCP tool call failed: ${error.message}`);
            throw error;
        }
    }
    async close() {
        if (this.client) {
            // close method might not exist or be exposed directly in Client
            // but transport close handles cleanup
        }
        if (this.transport) {
            await this.transport.close();
        }
        this.client = null;
        this.transport = null;
    }
}
exports.MCPClient = MCPClient;
