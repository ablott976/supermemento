import { SupermementoServer } from "./server.js";

async function main(): Promise<void> {
  const server = new SupermementoServer();

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = process.env.MCP_TRANSPORT ?? "sse";
  const port = parseInt(process.env.MCP_PORT ?? process.env.PORT ?? "8080", 10);
  const host = process.env.MCP_HOST ?? "0.0.0.0";

  if (transport === "stdio") {
    console.log("[supermemento] Starting in stdio mode");
    await server.startStdio();
  } else {
    console.log(`[supermemento] Starting in SSE mode on ${host}:${port}`);
    await server.startSSE(port, host);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
