import { randomUUID } from "crypto";
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  JSONRPCError,
  JSONRPCNotification,
  ListToolsRequestSchema,
  LoggingMessageNotification,
  Notification,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";

const SESSION_ID_HEADER_NAME = "mcp-session-id";
const JSON_RPC_VERSION = "2.0";
const METRICOOL_BASE_URL = "https://app.metricool.com/api";

interface MetricoolConfig {
  userId: string;
  userToken: string;
  defaultBlogId?: string;
}

interface MetricoolRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  blogId?: string;
}

class MetricoolClient {
  private readonly config: MetricoolConfig;

  constructor(config: MetricoolConfig) {
    if (!config.userId) {
      throw new Error("METRICOOL_USER_ID is required");
    }

    if (!config.userToken) {
      throw new Error("METRICOOL_USER_TOKEN is required");
    }

    this.config = config;
  }

  getDefaultBlogId(): string | undefined {
    return this.config.defaultBlogId;
  }

  async get<T>(path: string, options?: MetricoolRequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async post<T>(path: string, options?: MetricoolRequestOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  async put<T>(path: string, options?: MetricoolRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  private resolveBlogId(override?: string): string | undefined {
    return override || this.config.defaultBlogId;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: MetricoolRequestOptions,
  ): Promise<T> {
    const url = new URL(`${METRICOOL_BASE_URL}${path}`);

    const params = new URLSearchParams();
    params.set("userId", this.config.userId);
    params.set("userToken", this.config.userToken);

    const effectiveBlogId = this.resolveBlogId(options?.blogId);
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

    const response = await fetch(url, requestInit);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Metricool API ${method} ${path} failed with ${response.status}: ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

interface PublicBlogSummary {
  id?: number;
  label?: string;
  title?: string;
  timezone?: string;
}

interface TimelinePoint {
  date: string;
  value: number;
}

interface ReportHistoryItem {
  creationDate?: string;
  from?: string;
  to?: string;
  status?: string;
  reportFile?: string;
  reportType?: string;
}

interface ReportHistoryResponse {
  data?: ReportHistoryItem[];
}

interface ReportStatusResponse {
  data?: {
    status?: string;
    reportPath?: string;
  };
}

interface PublicPostSummary {
  postUrl?: string;
  title?: string;
  date?: string;
  totalShares?: number;
  pageViews?: number;
}

export interface MetricoolServerOptions {
  config: MetricoolConfig;
}

export class MetricoolMCPServer {
  private readonly server: Server;
  private readonly transports: Record<string, StreamableHTTPServerTransport> = {};
  private readonly client: MetricoolClient;

  private readonly listBrandsTool = "metricool-list-brands";
  private readonly timelineTool = "metricool-get-timeline";
  private readonly valuesTool = "metricool-get-values";
  private readonly reportsTool = "metricool-list-reports";
  private readonly reportStatusTool = "metricool-report-status";
  private readonly postsTool = "metricool-get-posts";

  constructor(server: Server, options: MetricoolServerOptions) {
    this.server = server;
    this.client = new MetricoolClient(options.config);
    this.setupTools();
  }

  async handleGetRequest(req: Request, res: Response) {
    const sessionId = req.headers[SESSION_ID_HEADER_NAME] as string | undefined;
    if (!sessionId || !this.transports[sessionId]) {
      res
        .status(400)
        .json(this.createErrorResponse("Bad Request: invalid session ID."));
      return;
    }

    const transport = this.transports[sessionId];
    await transport.handleRequest(req, res);
    await this.streamMessages(transport);
  }

  async handlePostRequest(req: Request, res: Response) {
    const sessionId = req.headers[SESSION_ID_HEADER_NAME] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    try {
      if (sessionId && this.transports[sessionId]) {
        transport = this.transports[sessionId];
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && this.isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        await this.server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        const generatedSessionId = transport.sessionId;
        if (generatedSessionId) {
          this.transports[generatedSessionId] = transport;
        }
        return;
      }

      res
        .status(400)
        .json(this.createErrorResponse("Bad Request: invalid session."));
    } catch (error) {
      console.error("Error handling MCP request:", error);
      res
        .status(500)
        .json(this.createErrorResponse("Internal server error."));
    }
  }

  async cleanup() {
    await this.server.close();
  }

  private setupTools() {
    const tools = [
      {
        name: this.listBrandsTool,
        description: "List all brands (blogs) available to the Metricool account",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: this.timelineTool,
        description:
          "Fetch a time series for a Metricool metric between optional start/end dates",
        inputSchema: {
          type: "object",
          properties: {
            metric: {
              type: "string",
              description:
                "Metric identifier, e.g. igFollowers, facebookLikes, SessionsCount",
            },
            start: {
              type: "string",
              description: "Start date in YYYYMMDD",
            },
            end: {
              type: "string",
              description: "End date in YYYYMMDD",
            },
            blogId: {
              type: "string",
              description: "Override blogId; defaults to METRICOOL_BLOG_ID if set",
            },
          },
          required: ["metric"],
        },
      },
      {
        name: this.valuesTool,
        description:
          "Get aggregated values for a Metricool category on a specific day",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description:
                "Category identifier, e.g. Audience, Facebook, instagram, FacebookAds",
            },
            date: {
              type: "string",
              description: "Date in YYYYMMDD (defaults to today if omitted)",
            },
            blogId: {
              type: "string",
              description: "Override blogId; defaults to METRICOOL_BLOG_ID if set",
            },
          },
          required: ["category"],
        },
      },
      {
        name: this.postsTool,
        description: "Retrieve website posts published in a period",
        inputSchema: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description: "Start date in YYYYMMDD",
            },
            end: {
              type: "string",
              description: "End date in YYYYMMDD",
            },
            blogId: {
              type: "string",
              description: "Override blogId; defaults to METRICOOL_BLOG_ID if set",
            },
          },
        },
      },
      {
        name: this.reportsTool,
        description: "List generated reports for a given brand",
        inputSchema: {
          type: "object",
          properties: {
            blogId: {
              type: "string",
              description: "Brand identifier to query; defaults to METRICOOL_BLOG_ID",
            },
          },
        },
      },
      {
        name: this.reportStatusTool,
        description: "Check the status of a specific report job",
        inputSchema: {
          type: "object",
          properties: {
            jobId: {
              type: "string",
              description: "Report job identifier",
            },
            blogId: {
              type: "string",
              description: "Brand identifier; defaults to METRICOOL_BLOG_ID",
            },
          },
          required: ["jobId"],
        },
      },
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = (request.params.arguments || {}) as Record<string, unknown>;

      if (!toolName) {
        throw new Error("Tool name is required");
      }

      try {
        switch (toolName) {
          case this.listBrandsTool:
            return await this.handleListBrands();
          case this.timelineTool:
            return await this.handleTimeline(args);
          case this.valuesTool:
            return await this.handleValues(args);
          case this.reportsTool:
            return await this.handleReports(args);
          case this.reportStatusTool:
            return await this.handleReportStatus(args);
          case this.postsTool:
            return await this.handlePosts(args);
          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected Metricool error";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Metricool API call failed: ${message}`,
            },
          ],
        };
      }
    });
  }

  private formatAsJson(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  private async handleListBrands() {
    const blogs = await this.client.get<PublicBlogSummary[]>(
      "/admin/simpleProfiles",
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
          text: this.formatAsJson(simplified),
        },
      ],
    };
  }

  private async handleTimeline(args: Record<string, unknown>) {
    const metric = String(args.metric || "").trim();
    if (!metric) {
      throw new Error("metric is required");
    }

    const start = args.start ? String(args.start) : undefined;
    const end = args.end ? String(args.end) : undefined;
    const blogId = args.blogId ? String(args.blogId) : undefined;

    const rawPoints = await this.client.get<[string, string | number][]>(
      `/stats/timeline/${encodeURIComponent(metric)}`,
      {
        query: {
          start,
          end,
        },
        blogId,
      },
    );

    const points: TimelinePoint[] = rawPoints.map((entry) => ({
      date: entry[0],
      value: Number(entry[1]),
    }));

    return {
      content: [
        {
          type: "text",
          text: this.formatAsJson(points),
        },
      ],
    };
  }

  private async handleValues(args: Record<string, unknown>) {
    const category = String(args.category || "").trim();
    if (!category) {
      throw new Error("category is required");
    }

    const date = args.date ? String(args.date) : undefined;
    const blogId = args.blogId ? String(args.blogId) : undefined;

    const values = await this.client.get<Record<string, number>>(
      `/stats/values/${encodeURIComponent(category)}`,
      {
        query: { date },
        blogId,
      },
    );

    return {
      content: [
        {
          type: "text",
          text: this.formatAsJson(values),
        },
      ],
    };
  }

  private async handleReports(args: Record<string, unknown>) {
    const blogId = args.blogId ? String(args.blogId) : undefined;
    const resolvedBlogId = blogId ?? this.client.getDefaultBlogId();

    if (!resolvedBlogId) {
      throw new Error(
        "blogId is required for reports. Set METRICOOL_BLOG_ID or pass blogId.",
      );
    }

    const response = await this.client.get<ReportHistoryResponse>(
      `/v2/brands/${encodeURIComponent(resolvedBlogId)}/reports`,
      { blogId: resolvedBlogId },
    );

    const items = (response.data || []).map((item) => ({
      from: item.from,
      to: item.to,
      createdAt: item.creationDate,
      reportType: item.reportType,
      status: item.status,
      downloadUrl: item.reportFile,
    }));

    return {
      content: [
        {
          type: "text",
          text: this.formatAsJson(items),
        },
      ],
    };
  }

  private async handleReportStatus(args: Record<string, unknown>) {
    const jobId = String(args.jobId || "").trim();
    if (!jobId) {
      throw new Error("jobId is required");
    }

    const blogId = args.blogId ? String(args.blogId) : undefined;
    const resolvedBlogId = blogId ?? this.client.getDefaultBlogId();

    if (!resolvedBlogId) {
      throw new Error(
        "blogId is required for report status. Set METRICOOL_BLOG_ID or pass blogId.",
      );
    }

    const statusResponse = await this.client.get<ReportStatusResponse>(
      `/v2/brands/${encodeURIComponent(resolvedBlogId)}/reports/${encodeURIComponent(
        jobId,
      )}`,
      { blogId: resolvedBlogId },
    );

    const status = statusResponse.data || {};

    return {
      content: [
        {
          type: "text",
          text: this.formatAsJson(status),
        },
      ],
    };
  }

  private async handlePosts(args: Record<string, unknown>) {
    const start = args.start ? String(args.start) : undefined;
    const end = args.end ? String(args.end) : undefined;
    const blogId = args.blogId ? String(args.blogId) : undefined;

    const posts = await this.client.get<PublicPostSummary[]>("/stats/posts", {
      query: { start, end },
      blogId,
    });

    const simplified = posts.map((post) => ({
      title: post.title,
      url: post.postUrl,
      publishedAt: post.date,
      totalShares: post.totalShares,
      pageViews: post.pageViews,
    }));

    return {
      content: [
        {
          type: "text",
          text: this.formatAsJson(simplified),
        },
      ],
    };
  }

  private async streamMessages(transport: StreamableHTTPServerTransport) {
    const intro: LoggingMessageNotification = {
      method: "notifications/message",
      params: {
        level: "info",
        data: "Metricool stream established. Use tools to query analytics.",
      },
    };

    await this.sendNotification(transport, intro);

    const followUp: LoggingMessageNotification = {
      method: "notifications/message",
      params: {
        level: "info",
        data: "Remember to provide METRICOOL_USER_TOKEN, METRICOOL_USER_ID, and optionally METRICOOL_BLOG_ID in the server environment.",
      },
    };

    await this.sendNotification(transport, followUp);
  }

  private async sendNotification(
    transport: StreamableHTTPServerTransport,
    notification: Notification,
  ) {
    const rpcNotification: JSONRPCNotification = {
      ...notification,
      jsonrpc: JSON_RPC_VERSION,
    };
    await transport.send(rpcNotification);
  }

  private createErrorResponse(message: string): JSONRPCError {
    return {
      jsonrpc: JSON_RPC_VERSION,
      error: {
        code: -32000,
        message,
      },
      id: randomUUID(),
    };
  }

  private isInitializeRequest(body: unknown): boolean {
    const isInitial = (data: unknown) => {
      const result = InitializeRequestSchema.safeParse(data);
      return result.success;
    };

    if (Array.isArray(body)) {
      return body.some((request) => isInitial(request));
    }

    return isInitial(body);
  }
}
