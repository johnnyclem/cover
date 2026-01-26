import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./ui";

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    private serverCommand: string,
    private serverArgs: string[] = [],
    private env: NodeJS.ProcessEnv = {}
  ) {}

  async connect() {
    try {
      const filteredEnv = Object.fromEntries(
        Object.entries({ ...process.env, ...this.env }).filter(
          ([_, value]) => value !== undefined
        )
      ) as Record<string, string>;

      this.transport = new StdioClientTransport({
        command: this.serverCommand,
        args: this.serverArgs,
        env: filteredEnv,
      });

      this.client = new Client(
        {
          name: "cover-mcp-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await this.client.connect(this.transport);
      logger.info(`Connected to MCP server: ${this.serverCommand}`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to connect to MCP server: ${error.message}`);
      return false;
    }
  }

  async callTool(name: string, args: any): Promise<CallToolResult> {
    if (!this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      const result = await this.client.callTool({
        name,
        arguments: args,
      });
      return result as CallToolResult;
    } catch (error: any) {
      logger.error(`MCP tool call failed: ${error.message}`);
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
