# Metricool MCP Server (Cloudflare Ready)

This project packages a streamable HTTP MCP server that wraps the Metricool API. It is designed to run locally for development and to be deployable on Cloudflare's MCP hosting (Workers with `nodejs_compat` or Pages Functions).

## Features

- Implements MCP tools for Metricool brands, timeline metrics, aggregated values, report history/status, and website posts.
- Streamable HTTP transport compatible with Claude, Cursor, and other MCP clients.
- Ready to containerize or adapt for Cloudflare deployment; simply provide Metricool credentials via environment variables.

## Requirements

- Node.js 18+
- Metricool Advanced plan credentials (user token + user ID, and optionally a blog/brand ID)

## Local Development

```bash
cd metricool-cloudflare-server
npm install
METRICOOL_USER_ID=12345 \
METRICOOL_USER_TOKEN=abcde \
METRICOOL_BLOG_ID=67890 \   # optional
npm run build
node build/index.js
```

While the server is running, send MCP requests:

```bash
curl -i -X POST http://localhost:8123/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":"1",
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-02-10",
      "clientInfo":{"name":"tester","version":"1.0"},
      "capabilities":{}
    }
  }'
```

Use the returned `mcp-session-id` for subsequent `tools/list` and `tools/call` requests.

## Cloudflare Deployment (High Level)

1. Enable `nodejs_compat` in `wrangler.toml` or via Workers dashboard so Express & Node APIs are available.
2. Build the project (`npm run build`).
3. Bundle the output (e.g., with `esbuild`) or rely on Wrangler's automatic bundling.
4. Set secrets for Metricool credentials:
   ```bash
   wrangler secret put METRICOOL_USER_ID
   wrangler secret put METRICOOL_USER_TOKEN
   wrangler secret put METRICOOL_BLOG_ID   # optional
   ```
5. Deploy: `wrangler deploy --entry build/index.js`

Refer to Cloudflare MCP hosting documentation for exact deployment instructions and supported runtimes.

## Repository Layout

- `metricool-cloudflare-server/` – TypeScript source, configs, and build output after `npm run build`.
- `README.md` – This guide.

## Next Steps

Extend `MetricoolMCPServer` with additional tools by referencing the official `mcp-metricool` Python implementation in `AI Projects/mcp-metricool` or endpoints described in `metricool_swagger.json`.
