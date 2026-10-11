import cors from "@fastify/cors";
import { runAgentScenario, type AgentRunResult, type RunScenarioInput } from "@contextcaps/agent";
import type {
  CreateMandateRequest,
  SessionContextRequest,
  SessionDelegationRequest,
  SessionToolInvocationRequest,
} from "@contextcaps/shared-types";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { z } from "zod";
import { BrokerInputError, SessionError, type ContextBroker } from "../broker";
import type { Clock } from "../runtime";
import {
  agentRunSchema,
  auditQuerySchema,
  createMandateSchema,
  sessionContextRequestSchema,
  sessionDelegationSchema,
  sessionToolInvocationSchema,
} from "./schemas";

/** Runs the LLM planner for a mandate; undefined when no LLM provider is configured. */
export type LlmRunner = (input: RunScenarioInput) => Promise<AgentRunResult>;

export interface ServerOptions {
  broker: ContextBroker;
  clock: Clock;
  /** Enables POST /api/v1/demo/reset. */
  demoMode: boolean;
  onReset?: () => void;
  corsOrigins?: string[] | true;
  llmRunner?: LlmRunner;
}

export const SESSION_HEADER = "x-contextcaps-session";

/** Session token from `x-contextcaps-session` or `Authorization: Bearer <token>`. */
function sessionToken(request: FastifyRequest): string | undefined {
  const header = request.headers[SESSION_HEADER];
  if (typeof header === "string" && header.length > 0) return header;
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim() || undefined;
  return undefined;
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
  await app.register(cors, {
    origin: options.corsOrigins ?? true,
    allowedHeaders: ["content-type", "authorization", SESSION_HEADER],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SessionError) {
      return reply.code(401).send({ error: "INVALID_SESSION", allowed: false, decision: "DENY", reason: error.message });
    }
    if (error instanceof BrokerInputError) {
      return reply.code(error.status).send({ error: "INVALID_REQUEST", message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "INVALID_REQUEST", message: (error as Error).message });
    }
    return reply.code(502).send({ error: "UPSTREAM_FAILURE", message: "Broker could not complete the operation." });
  });

  app.get("/api/v1/health", async () => ({
    ok: true,
    provider: broker.providerName,
    llmPlanner: options.llmRunner ? "available" : "unavailable",
  }));

  // ------------------------------------------------ principal (user) actions

  app.post("/api/v1/mandates", async (request, reply) => {
    const body = parse(createMandateSchema, request.body, reply);
    if (!body) return reply;
    const created = await broker.createMandate(body as CreateMandateRequest);
    return reply.code(201).send(created);
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

  // ------------------------------------------ agent actions (session-bound)

  app.post("/api/v1/context/request", async (request, reply) => {
    const body = parse(sessionContextRequestSchema, request.body, reply);
    if (!body) return reply;
    return broker.requestContextForSession(sessionToken(request), body as SessionContextRequest);
  });

  app.post("/api/v1/delegations", async (request, reply) => {
    const body = parse(sessionDelegationSchema, request.body, reply);
    if (!body) return reply;
    const result = await broker.delegateForSession(sessionToken(request), body as SessionDelegationRequest);
    return reply.code(result.allowed ? 201 : 403).send(result);
  });

  app.post<{ Params: { toolId: string } }>("/api/v1/tools/:toolId/invoke", async (request, reply) => {
    const body = parse(sessionToolInvocationSchema, request.body, reply);
    if (!body) return reply;
    return broker.invokeToolForSession(sessionToken(request), request.params.toolId, body as SessionToolInvocationRequest);
  });

  // Runs the Travel Agent in-process with the mandate's root session (demo / web integration).
  app.post("/api/v1/agent/runs", async (request, reply) => {
    const body = parse(agentRunSchema, request.body, reply);
    if (!body) return reply;
    const mandate = broker.store.mandates.get(body.mandateId);
    const session = mandate ? broker.rootSession(mandate.mandateId) : undefined;
    if (!mandate || !session) return reply.code(404).send({ error: "NOT_FOUND", message: "Unknown mandate." });
    const input: RunScenarioInput = { mandate, session, scenario: body.scenario, injection: body.injection, clock };
    if (body.planner === "llm") {
      if (!options.llmRunner) {
        return reply.code(503).send({ error: "LLM_UNAVAILABLE", message: "No LLM provider configured; use planner \"scripted\"." });
      }
      return options.llmRunner(input);
    }
    return runAgentScenario(broker, input);
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
