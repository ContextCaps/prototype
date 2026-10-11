import cors from "@fastify/cors";
import { runAgentScenario } from "@contextcaps/agent";
import type { ContextRequest, CreateDelegationRequest, CreateMandateRequest, ToolInvocationRequest } from "@contextcaps/shared-types";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { z } from "zod";
import { BrokerInputError, type ContextBroker } from "../broker";
import type { Clock } from "../runtime";
import {
  agentRunSchema,
  auditQuerySchema,
  contextRequestSchema,
  createDelegationSchema,
  createMandateSchema,
  toolInvocationSchema,
} from "./schemas";

export interface ServerOptions {
  broker: ContextBroker;
  clock: Clock;
  /** Enables POST /api/v1/demo/reset. */
  demoMode: boolean;
  onReset?: () => void;
  corsOrigins?: string[] | true;
}

function parse<T extends z.ZodType>(schema: T, input: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  // Report paths/messages only — never echo submitted values.
  void reply.code(400).send({
    error: "INVALID_REQUEST",
    issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
  return undefined;
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const { broker, clock } = options;
  // Fastify's request logger is disabled: decisions are logged through the SafeLogger only.
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: options.corsOrigins ?? true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BrokerInputError) {
      return reply.code(error.status).send({ error: "INVALID_REQUEST", message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "INVALID_REQUEST", message: (error as Error).message });
    }
    return reply.code(502).send({ error: "UPSTREAM_FAILURE", message: "Broker could not complete the operation." });
  });

  app.get("/api/v1/health", async () => ({ ok: true, provider: broker.providerName }));

  app.post("/api/v1/mandates", async (request, reply) => {
    const body = parse(createMandateSchema, request.body, reply);
    if (!body) return reply;
    const created = await broker.createMandate(body as CreateMandateRequest);
    return reply.code(201).send(created);
  });

  app.post("/api/v1/context/request", async (request, reply) => {
    const body = parse(contextRequestSchema, request.body, reply);
    if (!body) return reply;
    return broker.requestContext(body as ContextRequest);
  });

  app.post("/api/v1/delegations", async (request, reply) => {
    const body = parse(createDelegationSchema, request.body, reply);
    if (!body) return reply;
    const result = await broker.delegate(body as CreateDelegationRequest);
    return reply.code(result.allowed ? 201 : 403).send(result);
  });

  app.post<{ Params: { id: string } }>("/api/v1/capabilities/:id/revoke", async (request, reply) => {
    const state = await broker.revokeCapability(request.params.id);
    if (!state) return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown capability." });
    return state;
  });

  app.get<{ Params: { id: string } }>("/api/v1/capabilities/:id", async (request, reply) => {
    const state = await broker.getCapability(request.params.id);
    if (!state) return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown capability." });
    return state;
  });

  app.get("/api/v1/audit", async (request, reply) => {
    const query = parse(auditQuerySchema, request.query, reply);
    if (!query) return reply;
    return broker.getAudit(query.mandateId);
  });

  // Additive: tool-bound invocation (the agent passes opaque handles; the gateway injects secrets).
  app.post<{ Params: { toolId: string } }>("/api/v1/tools/:toolId/invoke", async (request, reply) => {
    const body = parse(toolInvocationSchema, request.body, reply);
    if (!body) return reply;
    return broker.invokeTool(request.params.toolId, body as ToolInvocationRequest);
  });

  // Additive: run the Travel Agent through the real broker path (demo / web integration).
  app.post("/api/v1/agent/runs", async (request, reply) => {
    const body = parse(agentRunSchema, request.body, reply);
    if (!body) return reply;
    const mandate = broker.store.mandates.get(body.mandateId);
    if (!mandate) return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown mandate." });
    const rootCapabilityId =
      body.capabilityId ??
      [...broker.store.capabilities.values()].find(
        (r) => r.capability.mandateId === mandate.mandateId && r.capability.parentCapabilityId === undefined,
      )?.capability.capabilityId;
    if (!rootCapabilityId) return reply.code(404).send({ error: "NOT_FOUND", message: "No root capability." });
    return runAgentScenario(broker, { mandate, capabilityId: rootCapabilityId, scenario: body.scenario, clock });
  });

  if (options.demoMode) {
    app.post("/api/v1/demo/reset", async () => {
      broker.reset();
      options.onReset?.();
      return { ok: true };
    });
  }

  return app;
}
