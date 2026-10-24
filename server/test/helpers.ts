/**
 * A server on a random loopback port with a throwaway data folder, and a tiny
 * client with a cookie jar — what every API test starts from.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type App, type AppOptions } from "../src/app";
import { testConfig, type ServerConfig } from "../src/config";

export interface Running {
  app: App;
  url: string;
  dataDir: string;
  close(): Promise<void>;
}

export async function startServer(overrides: Partial<ServerConfig> = {}, options: AppOptions = {}): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), "spar-server-test-"));
  const app = await createApp(testConfig(dataDir, overrides), options);
  const { url } = await app.listen();
  return {
    app,
    url,
    dataDir,
    async close() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Answer {
  status: number;
  headers: Headers;
  body: Record<string, unknown> | null;
  text: string;
}

export class Client {
  cookie: string | null = null;
  userId = "";

  constructor(private readonly base: string) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Answer> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie && !("cookie" in h)) h.cookie = this.cookie;
    let payload: string | Uint8Array | undefined;
    if (body instanceof Uint8Array) {
      payload = body;
      h["x-spar-request"] ??= "1";
    } else if (typeof body === "string") {
      payload = body;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      h["content-type"] ??= "application/json";
    }
    const response = await fetch(`${this.base}${path}`, { method, headers: h, body: payload });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0];
      this.cookie = /Max-Age=0/.test(setCookie) ? null : pair;
    }
    const text = await response.text();
    let parsed: Record<string, unknown> | null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, headers: response.headers, body: parsed, text };
  }

  async signUp(email = `user-${randomUUID()}@example.test`, password = "a long enough password", invite?: string): Promise<Answer> {
    const answer = await this.request("POST", "/api/auth/signup", { email, password, ...(invite ? { invite } : {}) });
    if (answer.status === 201) this.userId = (answer.body?.user as { id: string }).id;
    return answer;
  }

  async logIn(email: string, password: string): Promise<Answer> {
    const answer = await this.request("POST", "/api/auth/login", { email, password });
    if (answer.status === 200) this.userId = (answer.body?.user as { id: string }).id;
    return answer;
  }
}

export function note(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stamp = "2031-03-14T09:00:00.000Z";
  return {
    id: randomUUID(),
    raw_content: "a captured thought",
    body: "a captured thought",
    source: "web",
    created_at: stamp,
    updated_at: stamp,
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    reminder_repeat: null,
    done: null,
    merged_from: null,
    merged_into: null,
    keep_id: null,
    attachments: [],
    link_previews: [],
    field_updated_at: {},
    ...overrides,
  };
}
