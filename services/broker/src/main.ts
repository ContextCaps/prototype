import { createBrokerApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { randomIds, sequentialIds } from "./runtime";

const config = loadConfig();
const logger = createLogger();
// Demo mode uses sequential ids (mdt_0001, cap_0001 after every reset) so the
// web app and scripts see stable identifiers. Session tokens and tool handles
// are always random regardless.
// On-chain IDs are immutable and cannot be reused after a broker reset or restart.
const { server } = await createBrokerApp(config, { logger, ids: config.demoMode && config.chainProvider === "mock" ? sequentialIds() : randomIds });

await server.listen({ port: config.port, host: config.host });
logger.info("broker.listening", { provider: config.chainProvider });
process.stdout.write(`ContextCaps broker listening on http://${config.host}:${config.port}/api/v1\n`);
