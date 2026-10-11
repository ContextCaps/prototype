import { createBrokerApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";

const config = loadConfig();
const logger = createLogger();
const { server } = await createBrokerApp(config, { logger });

await server.listen({ port: config.port, host: config.host });
logger.info("broker.listening", { provider: config.chainProvider });
process.stdout.write(`ContextCaps broker listening on http://${config.host}:${config.port}/api/v1\n`);
