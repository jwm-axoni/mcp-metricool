import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { MetricoolMCPServer } from "./server.js";

const METRICOOL_BASE_URL = "https://app.metricool.com/api";

type EnvBindings = {
  METRICOOL_USER_ID?: string;
  METRICOOL_USER_TOKEN?: string;
  METRICOOL_BLOG_ID?: string;
};

interface MetricoolConfig {
  userId: string;
  userToken: string;
  defaultBlogId?: string;
}

interface PublicBlogSummary {
  id: string;
  label?: string;
  title: string;
  timezone?: string;
}

interface TimelinePoint {
  date: string;
  value: number;
}

function buildConfig(env: EnvBindings): MetricoolConfig {
  return {
    userId: env.METRICOOL_USER_ID || "",
    userToken: env.METRICOOL_USER_TOKEN || "",
    defaultBlogId: env.METRICOOL_BLOG_ID,
  };
}

// Direct API call function
async function metricoolApiCall<T>(
  config: MetricoolConfig,
  method: string,
  path: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    blogId?: string;
  }
): Promise<T> {
  const url = new URL(`${METRICOOL_BASE_URL}${path}`);
  
  const params = new URLSearchParams();
  params.set("userId", config.userId);
  params.set("userToken", config.userToken);

  const effectiveBlogId = options?.blogId || config.defaultBlogId;
  if (effectiveBlogId) {
    params.set("blogId", effectiveBlogId);
  }

  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
  }

  url.search = params.toString();

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const requestInit: RequestInit = {
    method,
    headers,
  };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await fetch(url.toString(), requestInit);

  if (!response.ok) {
    throw new Error(`Metricool API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Tool handler functions
async function handleListBrands(config: MetricoolConfig) {
  const blogs = await metricoolApiCall<PublicBlogSummary[]>(
    config,
    "GET",
    "/admin/simpleProfiles"
  );

  const simplified = blogs.map((blog) => ({
    id: blog.id,
    label: blog.label || blog.title,
    title: blog.title,
    timezone: blog.timezone,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(simplified, null, 2),
      },
    ],
  };
}

async function handleTimeline(config: MetricoolConfig, args: Record<string, unknown>) {
  const metric = String(args.metric || "").trim();
  if (!metric) {
    throw new Error("metric is required");
  }

  const start = args.start ? String(args.start) : undefined;
  const end = args.end ? String(args.end) : undefined;
  const blogId = args.blogId ? String(args.blogId) : undefined;

  const rawPoints = await metricoolApiCall<[string, string | number][]>(
    config,
    "GET",
    `/stats/timeline/${encodeURIComponent(metric)}`,
    {
      query: { start, end },
      blogId,
    }
  );

  const points: TimelinePoint[] = rawPoints.map((entry) => ({
    date: entry[0],
    value: Number(entry[1]),
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(points, null, 2),
      },
    ],
  };
}

async function handleValues(config: MetricoolConfig, args: Record<string, unknown>) {
  const category = String(args.category || "").trim();
  if (!category) {
    throw new Error("category is required");
  }

  const date = args.date ? String(args.date) : undefined;
  const blogId = args.blogId ? String(args.blogId) : undefined;

  const data = await metricoolApiCall<Record<string, unknown>>(
    config,
    "GET",
    `/stats/values/${encodeURIComponent(category)}`,
    {
      query: { date },
      blogId,
    }
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function handlePosts(config: MetricoolConfig, args: Record<string, unknown>) {
  const start = args.start ? String(args.start) : undefined;
  const end = args.end ? String(args.end) : undefined;
  const blogId = args.blogId ? String(args.blogId) : undefined;

  const posts = await metricoolApiCall<unknown[]>(
    config,
    "GET",
    "/posts",
    {
      query: { start, end },
      blogId,
    }
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(posts, null, 2),
      },
    ],
  };
}

async function handleListReports(config: MetricoolConfig, args: Record<string, unknown>) {
  const blogId = args.blogId ? String(args.blogId) : undefined;

  const reports = await metricoolApiCall<unknown[]>(
    config,
    "GET",
    "/reports",
    { blogId }
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(reports, null, 2),
      },
    ],
  };
}

async function handleReportStatus(config: MetricoolConfig, args: Record<string, unknown>) {
  const jobId = String(args.jobId || "").trim();
  if (!jobId) {
    throw new Error("jobId is required");
  }

  const blogId = args.blogId ? String(args.blogId) : undefined;

  const status = await metricoolApiCall<unknown>(
    config,
    "GET",
    `/reports/${encodeURIComponent(jobId)}/status`,
    { blogId }
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(status, null, 2),
      },
    ],
  };
}

const sdkServer = new Server(
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
);

let metricoolServer: MetricoolMCPServer | null = null;

function getMetricoolServer(env: EnvBindings) {
  if (!metricoolServer) {
    const config = buildConfig(env);
    metricoolServer = new MetricoolMCPServer(sdkServer, { config });
  }
  return metricoolServer;
}

function createMockRequest(request: Request, body: unknown) {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    method: request.method,
    url: new URL(request.url).pathname,
    headers,
    body,
  } as any;
}

function createJsonResponseController() {
  let statusCode = 200;
  const headers = new Headers();
  let body: string | null = null;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = JSON.stringify(payload);
      headers.set("content-type", "application/json");
    },
    send(payload: any) {
      body = typeof payload === "string" ? payload : String(payload);
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(code: number, message?: string | Record<string, string>, hdrs?: Record<string, string>) {
      statusCode = code;
      const extraHeaders =
        typeof message === "object" ? message : hdrs;
      if (extraHeaders) {
        Object.entries(extraHeaders).forEach(([key, value]) => {
          headers.set(key.toLowerCase(), value);
        });
      }
      return res;
    },
    write(chunk: any) {
      const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      body = (body || "") + text;
    },
    end() {},
    flushHeaders() {
      return res;
    },
    on() {
      return res;
    },
  };

  return {
    res,
    getResponse() {
      return new Response(body ?? "", { status: statusCode, headers });
    },
  };
}

function createStreamResponseController(request: Request) {
  let statusCode = 200;
  const headers = new Headers();
  const stream = new TransformStream<Uint8Array>();
  const writer = stream.writable.getWriter();
  let headersFlushed = false;
  const closeCallbacks: Array<() => void> = [];

  if (request.signal) {
    request.signal.addEventListener("abort", () => {
      closeCallbacks.forEach((cb) => {
        try {
          cb();
        } catch (error) {
          console.error("Error running close callback", error);
        }
      });
      writer.close();
    });
  }

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    flushHeaders() {
      headersFlushed = true;
      return res;
    },
    json(payload: unknown) {
      const text = JSON.stringify(payload);
      headers.set("content-type", "application/json");
      writer.write(new TextEncoder().encode(text));
    },
    send(payload: any) {
      const text = typeof payload === "string" ? payload : String(payload);
      writer.write(new TextEncoder().encode(text));
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(code: number, message?: string | Record<string, string>, hdrs?: Record<string, string>) {
      statusCode = code;
      const extraHeaders =
        typeof message === "object" ? message : hdrs;
      if (extraHeaders) {
        Object.entries(extraHeaders).forEach(([key, value]) => {
          headers.set(key.toLowerCase(), value);
        });
      }
      return res;
    },
    write(chunk: any) {
      const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      writer.write(new TextEncoder().encode(text));
    },
    end() {
      writer.close();
    },
    on(event: string, callback: () => void) {
      if (event === "close") {
        closeCallbacks.push(callback);
      }
    },
  };

  return {
    res,
    getResponse() {
      if (!headersFlushed) {
        headers.set(
          "content-type",
          headers.get("content-type") || "text/plain; charset=utf-8",
        );
      }

      return new Response(stream.readable, { status: statusCode, headers });
    },
  };
}

export default {
  async fetch(request: Request, env: EnvBindings) {
    const mcpServer = getMetricoolServer(env);
    const url = new URL(request.url);

    if (url.pathname === "/test") {
      // Test endpoint to debug what the server is returning
      const testResponse = {
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: [
              {
                name: "metricool-list-brands",
                description: "List all brands available",
                inputSchema: { type: "object", properties: {} }
              }
            ]
          },
          serverInfo: {
            name: "metricool-cloudflare-server",
            version: "0.1.0"
          }
        },
        id: 0
      };
      return new Response(JSON.stringify(testResponse), {
        headers: { "content-type": "application/json" }
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "POST") {
      let parsedBody: unknown = undefined;
      try {
        const text = await request.text();
        parsedBody = text ? JSON.parse(text) : undefined;
      } catch (error) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: "Invalid JSON payload",
            },
            id: null,
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }

      // Handle MCP requests directly
      const rpcRequest = parsedBody as any;
      console.log(`[MetricoolMCPServer] Received MCP request: ${rpcRequest?.method || 'unknown'}`);
      
      if (rpcRequest?.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              protocolVersion: "2025-03-26",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "metricool-cloudflare-server",
                version: "0.1.0",
              },
            },
            id: rpcRequest.id,
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (rpcRequest?.method === "notifications/initialized") {
        console.log("[MetricoolMCPServer] Received notifications/initialized");
        // Acknowledge the initialized notification
        return new Response("", { status: 200 });
      }
      
      if (rpcRequest?.method === "tools/call") {
        console.log("[MetricoolMCPServer] Received tools/call request for:", rpcRequest.params?.name);
        console.log("[MetricoolMCPServer] Tool arguments:", JSON.stringify(rpcRequest.params?.arguments));
        
        // Handle tool calls directly instead of going through MCP SDK transport
        try {
          const config = buildConfig(env);
          const toolName = rpcRequest.params?.name;
          const toolArgs = rpcRequest.params?.arguments || {};
          
          console.log("[MetricoolMCPServer] Executing tool directly:", toolName);
          
          // Call the appropriate tool handler directly
          let result;
          switch (toolName) {
            case "metricool-list-brands":
              result = await handleListBrands(config);
              break;
            case "metricool-get-timeline":
              result = await handleTimeline(config, toolArgs);
              break;
            case "metricool-get-values":
              result = await handleValues(config, toolArgs);
              break;
            case "metricool-get-posts":
              result = await handlePosts(config, toolArgs);
              break;
            case "metricool-list-reports":
              result = await handleListReports(config, toolArgs);
              break;
            case "metricool-report-status":
              result = await handleReportStatus(config, toolArgs);
              break;
            default:
              throw new Error(`Unknown tool: ${toolName}`);
          }
          
          console.log("[MetricoolMCPServer] Tool execution successful");
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result,
              id: rpcRequest.id,
            }),
            {
              headers: { "content-type": "application/json" },
            },
          );
        } catch (error) {
          console.error("[MetricoolMCPServer] Error handling tools/call:", error);
          console.error("[MetricoolMCPServer] Error stack:", error instanceof Error ? error.stack : "No stack");
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32603,
                message: "Internal error",
                data: error instanceof Error ? error.message : String(error),
              },
              id: rpcRequest.id,
            }),
            {
              status: 500,
              headers: { "content-type": "application/json" },
            },
          );
        }
      }

      if (rpcRequest?.method === "tools/list") {
        console.log("[MetricoolMCPServer] Received tools/list request");
        const tools = [
          {
            name: "metricool-list-brands",
            description: "List all brands (websites/blogs) available to the Metricool account. Use this first to discover available brand IDs for other operations. Returns brand details including names, domains, and IDs.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: "metricool-get-timeline",
            description: "Fetch historical data points for a specific metric over time. Useful for trend analysis, growth tracking, and performance monitoring. Returns time-series data with dates and values.",
            inputSchema: {
              type: "object",
              properties: {
                metric: {
                  type: "string",
                  description: "Metric identifier. Popular metrics include: 'igFollowers' (Instagram followers), 'facebookLikes' (Facebook page likes), 'SessionsCount' (website sessions), 'twitterFollowers', 'linkedinFollowers'. Use exact metric names.",
                  examples: ["igFollowers", "facebookLikes", "SessionsCount", "twitterFollowers", "linkedinFollowers"]
                },
                start: {
                  type: "string",
                  description: "Start date in YYYYMMDD format (e.g., '20240101' for January 1, 2024). If omitted, defaults to 30 days ago.",
                  pattern: "^\\d{8}$",
                  examples: ["20240101", "20240315"]
                },
                end: {
                  type: "string",
                  description: "End date in YYYYMMDD format (e.g., '20240131' for January 31, 2024). If omitted, defaults to today.",
                  pattern: "^\\d{8}$",
                  examples: ["20240131", "20240331"]
                },
                blogId: {
                  type: "string",
                  description: "Specific brand/blog ID to query. If not provided, uses the default configured brand. Get available IDs using metricool-list-brands.",
                },
              },
              required: ["metric"],
              additionalProperties: false,
            },
          },
          {
            name: "metricool-get-values",
            description: "Get current aggregated metrics and KPIs for a specific category on a given day. Perfect for getting current status, daily snapshots, or comparing specific dates.",
            inputSchema: {
              type: "object",
              properties: {
                category: {
                  type: "string",
                  description: "Analytics category to retrieve. Available categories: 'Audience' (follower counts across platforms), 'Facebook' (Facebook-specific metrics), 'Instagram' (Instagram-specific metrics), 'FacebookAds' (Facebook advertising metrics), 'Twitter', 'LinkedIn'. Use exact category names.",
                  examples: ["Audience", "Facebook", "Instagram", "FacebookAds", "Twitter", "LinkedIn"]
                },
                date: {
                  type: "string",
                  description: "Date in YYYYMMDD format (e.g., '20240315' for March 15, 2024). If omitted, returns data for today.",
                  pattern: "^\\d{8}$",
                  examples: ["20240315", "20240101"]
                },
                blogId: {
                  type: "string",
                  description: "Specific brand/blog ID to query. If not provided, uses the default configured brand. Get available IDs using metricool-list-brands.",
                },
              },
              required: ["category"],
              additionalProperties: false,
            },
          },
          {
            name: "metricool-get-posts",
            description: "Retrieve website posts/articles published within a specific time period. Useful for content analysis, publication tracking, and performance monitoring.",
            inputSchema: {
              type: "object",
              properties: {
                start: {
                  type: "string",
                  description: "Start date in YYYYMMDD format (e.g., '20240101'). If omitted, defaults to 30 days ago.",
                  pattern: "^\\d{8}$",
                  examples: ["20240101", "20240301"]
                },
                end: {
                  type: "string",
                  description: "End date in YYYYMMDD format (e.g., '20240131'). If omitted, defaults to today.",
                  pattern: "^\\d{8}$",
                  examples: ["20240131", "20240331"]
                },
                blogId: {
                  type: "string",
                  description: "Specific brand/blog ID to query. If not provided, uses the default configured brand. Get available IDs using metricool-list-brands.",
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: "metricool-list-reports",
            description: "List all generated analytics reports for a brand. Reports contain comprehensive data exports and analysis. Returns report metadata including IDs, names, creation dates, and status.",
            inputSchema: {
              type: "object",
              properties: {
                blogId: {
                  type: "string",
                  description: "Brand/blog identifier to query reports for. If not provided, uses the default configured brand. Get available IDs using metricool-list-brands.",
                },
              },
              additionalProperties: false,
            },
          },
          {
            name: "metricool-report-status",
            description: "Check the processing status and availability of a specific report job. Use this to monitor report generation progress and get download links when ready.",
            inputSchema: {
              type: "object",
              properties: {
                jobId: {
                  type: "string",
                  description: "Report job identifier returned from a report generation request or found in metricool-list-reports.",
                },
                blogId: {
                  type: "string",
                  description: "Brand/blog identifier that owns the report. If not provided, uses the default configured brand.",
                },
              },
              required: ["jobId"],
              additionalProperties: false,
            },
          },
        ];

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: { tools },
            id: rpcRequest.id,
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }

      const mockReq = createMockRequest(request, parsedBody);
      const { res, getResponse } = createJsonResponseController();
      await mcpServer.handlePostRequest(mockReq, res as any);
      return getResponse();
    }

    if (request.method === "GET") {
      // For GET requests (SSE), return a simple response since we don't support streaming
      return new Response("OK", { 
        status: 200, 
        headers: { "content-type": "text/plain" } 
      });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
