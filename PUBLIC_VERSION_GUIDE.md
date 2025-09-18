# 📋 Step-by-Step Guide: Creating a Public Multi-Tenant Metricool MCP Server

This document provides detailed instructions for any AI agent or developer to create a public, multi-tenant version of the Metricool MCP server while keeping the original private instance intact.

## 🎯 Objective

Create a public MCP server that allows multiple Metricool customers to use the service by providing their own credentials via HTTP headers, without storing or exposing any sensitive data.

## 📁 Project Structure Overview

```
mcp-streamable-http/
├── metricool-cloudflare-server/     # Original private instance
└── metricool-public-server/         # New public instance (to be created)
```

## 🚀 Implementation Steps

### Phase 1: Create Separate Public Instance

#### Step 1.1: Create Development Branch
```bash
cd /Users/jm/mcp-streamable-http
git checkout -b feature/public-version
```

#### Step 1.2: Create New Directory Structure
```bash
mkdir metricool-public-server
cd metricool-public-server

# Copy base files from original
cp ../metricool-cloudflare-server/package.json .
cp ../metricool-cloudflare-server/tsconfig.json .
cp -r ../metricool-cloudflare-server/src ./src

# Create new wrangler config for public instance
```

#### Step 1.3: Create New Wrangler Configuration
Create `metricool-public-server/wrangler.toml`:
```toml
name = "metricool-mcp-public"
main = "build/index.js"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

# No environment variables - will use header-based auth only

[observability]
enabled = true
```

### Phase 2: Implement Multi-Tenant Authentication

#### Step 2.1: Modify Configuration Builder
Update `src/index.ts` to add header-based credential extraction:

```typescript
function buildConfigFromRequest(request: Request): MetricoolConfig {
  const userId = request.headers.get("X-Metricool-User-ID") || "";
  const userToken = request.headers.get("X-Metricool-User-Token") || "";
  const defaultBlogId = request.headers.get("X-Metricool-Blog-ID");

  return {
    userId,
    userToken,
    defaultBlogId,
  };
}
```

#### Step 2.2: Add Credential Validation
Add validation logic before tool execution:

```typescript
// In tools/call handler
const config = buildConfigFromRequest(request);

if (!config.userId || !config.userToken) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Missing Metricool credentials",
        data: {
          required_headers: [
            "X-Metricool-User-ID: your_metricool_user_id",
            "X-Metricool-User-Token: your_metricool_user_token",
            "X-Metricool-Blog-ID: your_blog_id (optional)"
          ]
        }
      },
      id: rpcRequest.id,
    }),
    {
      status: 400,
      headers: { 
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
```

### Phase 3: Add CORS and Public API Features

#### Step 3.1: Implement CORS Support
Add CORS handling for public web access:

```typescript
// Handle OPTIONS requests for CORS preflight
if (request.method === "OPTIONS") {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Metricool-User-ID, X-Metricool-User-Token, X-Metricool-Blog-ID",
    },
  });
}

// Add CORS headers to all responses
headers: { 
  "content-type": "application/json",
  "Access-Control-Allow-Origin": "*",
}
```

#### Step 3.2: Create Documentation Endpoint
Add a public documentation page at root URL:

```typescript
if (url.pathname === "/" || url.pathname === "/docs") {
  const documentation = `
<!DOCTYPE html>
<html>
<head>
    <title>Public Metricool MCP Server</title>
    <style>/* CSS styling */</style>
</head>
<body>
    <h1>🚀 Public Metricool MCP Server</h1>
    <!-- Include comprehensive documentation -->
</body>
</html>`;
  
  return new Response(documentation, {
    headers: { 
      "content-type": "text/html",
      "Access-Control-Allow-Origin": "*",
    }
  });
}
```

### Phase 4: Enhanced Security and Rate Limiting

#### Step 4.1: Add Request Validation
Implement input validation and sanitization:

```typescript
// Validate credential format
function validateCredentials(userId: string, userToken: string): boolean {
  // Add validation logic for Metricool credential format
  return userId.match(/^\d+$/) && userToken.length > 10;
}

// Add rate limiting per IP (optional)
// Cloudflare Workers provides built-in DDoS protection
```

#### Step 4.2: Add Error Handling and Logging
Enhance error handling for public use:

```typescript
try {
  // Tool execution logic
} catch (error) {
  console.error(`[Public MCP] Tool error for user ${userId}:`, error);
  
  // Return sanitized error (don't expose internal details)
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Tool execution failed",
        data: "Please check your credentials and try again"
      },
      id: rpcRequest.id,
    }),
    { status: 500, headers: corsHeaders }
  );
}
```

### Phase 5: Testing and Validation

#### Step 5.1: Create Test Suite
Create `test/public-api.test.js`:

```javascript
// Test cases for public API
const testCases = [
  {
    name: "Missing credentials should return 400",
    request: { /* without headers */ },
    expectedStatus: 400
  },
  {
    name: "Valid credentials should work",
    request: { /* with valid headers */ },
    expectedStatus: 200
  }
  // Add more test cases
];
```

#### Step 5.2: Manual Testing Checklist
```bash
# Test CORS preflight
curl -X OPTIONS https://metricool-mcp-public.your-domain.workers.dev/mcp

# Test without credentials (should fail gracefully)
curl -X POST https://metricool-mcp-public.your-domain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "metricool-list-brands", "arguments": {}}, "id": 1}'

# Test with valid credentials (should work)
curl -X POST https://metricool-mcp-public.your-domain.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "X-Metricool-User-ID: TEST_USER_ID" \
  -H "X-Metricool-User-Token: TEST_TOKEN" \
  -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "metricool-list-brands", "arguments": {}}, "id": 1}'
```

### Phase 6: Deployment and Documentation

#### Step 6.1: Deploy Public Instance
```bash
cd metricool-public-server
npm run build
wrangler deploy

# Note the new public URL (different from private instance)
```

#### Step 6.2: Create Public Documentation
Update main README.md to include:
- Link to public instance
- Authentication instructions
- Usage examples
- MCP client configuration examples

#### Step 6.3: Create Usage Examples
Create `examples/` directory with:
- `claude-desktop-config.json` - Claude Desktop setup
- `curl-examples.sh` - Command-line examples
- `javascript-client.js` - Web client example
- `python-client.py` - Python MCP client example

### Phase 7: Monitoring and Maintenance

#### Step 7.1: Add Analytics (Optional)
```typescript
// Track usage without storing sensitive data
console.log(`[Analytics] Tool: ${toolName}, Success: ${success}, Timestamp: ${Date.now()}`);
```

#### Step 7.2: Create Monitoring Dashboard
Set up Cloudflare Analytics to monitor:
- Request volume
- Error rates
- Response times
- Geographic distribution

## 🔒 Security Considerations

### Critical Security Requirements:
1. **Never log credentials** - Only log sanitized request info
2. **Validate all inputs** - Prevent injection attacks
3. **Rate limiting** - Prevent abuse (Cloudflare provides this)
4. **Error sanitization** - Don't expose internal errors
5. **HTTPS only** - Cloudflare Workers enforces this
6. **No credential storage** - All auth is request-based

### Privacy Compliance:
1. **No data retention** - Don't store user data
2. **Direct API calls** - Data flows directly from Metricool to client
3. **Transparent processing** - Document what data flows through server
4. **User control** - Users control their own credentials

## 📦 Deployment Checklist

Before making public:
- [ ] All tests pass
- [ ] CORS properly configured
- [ ] Error handling sanitized
- [ ] Documentation complete
- [ ] Rate limiting considered
- [ ] Monitoring set up
- [ ] Security review completed
- [ ] Different URL from private instance
- [ ] No hardcoded credentials anywhere

## 🔧 Maintenance Tasks

### Regular Maintenance:
1. **Monitor error rates** - Check for API changes
2. **Update dependencies** - Keep packages current
3. **Review security** - Regular security audits
4. **Update documentation** - Keep examples current
5. **Monitor usage** - Track adoption and issues

### When Metricool API Changes:
1. Test all tools still work
2. Update tool schemas if needed
3. Update documentation
4. Notify users of any breaking changes

## 🎯 Success Criteria

The public version is ready when:
- [ ] Multiple users can use it with their own credentials
- [ ] No credentials are stored or logged
- [ ] All 6 tools work reliably
- [ ] Documentation is comprehensive
- [ ] CORS works for web clients
- [ ] Error messages are helpful but secure
- [ ] Monitoring is in place
- [ ] Original private instance is unaffected

## 🚀 Future Enhancements

Consider adding later:
1. **OAuth flow** - Eliminate need for manual credential entry
2. **API key management** - User-friendly credential management
3. **Webhook support** - Real-time data updates
4. **Caching** - Improve performance for repeated requests
5. **Additional metrics** - Expand beyond current 6 tools
6. **Multi-language support** - Internationalization

---

## ⚠️ Important Notes

- **Keep original instance private** - Don't modify the working private server
- **Use separate Cloudflare Worker** - Different name and URL
- **Test thoroughly** - Public APIs need robust error handling
- **Document everything** - Public APIs need comprehensive docs
- **Security first** - Never compromise on credential security

This guide ensures the public version is secure, scalable, and maintainable while preserving the original private instance functionality.