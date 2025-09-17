import express, { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { MetricoolMCPServer } from "./server.js";

type EnvConfig = {
  METRICOOL_USER_ID?: string;
  METRICOOL_USER_TOKEN?: string;
  METRICOOL_BLOG_ID?: string;
  PORT?: string;
};

function loadConfig(env: EnvConfig) {
  const userId = env.METRICOOL_USER_ID || "";
  const userToken = env.METRICOOL_USER_TOKEN || "";
  const defaultBlogId = env.METRICOOL_BLOG_ID;

  return {
    userId,
    userToken,
    defaultBlogId,
  };
}

const env = loadConfig(process.env);

const mcpServer = new MetricoolMCPServer(
  new Server(
    {
      name: "metricool-cloudflare-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  ),
  {
    config: env,
  },
);

const app = express();
app.use(express.json());

const MCP_ENDPOINT = "/mcp";

app.post(MCP_ENDPOINT, async (req: Request, res: Response) => {
  await mcpServer.handlePostRequest(req, res);
});

app.get(MCP_ENDPOINT, async (req: Request, res: Response) => {
  await mcpServer.handleGetRequest(req, res);
});

const port = parseInt(process.env.PORT || "8123", 10);

app.listen(port, () => {
  console.log(`Metricool MCP server listening on port ${port}`);
});

process.on("SIGINT", async () => {
  console.log("Shutting down Metricool MCP server...");
  await mcpServer.cleanup();
  process.exit(0);
});
