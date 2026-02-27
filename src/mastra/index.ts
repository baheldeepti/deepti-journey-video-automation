import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import fs from "fs";
import path from "path";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe } from "./inngest";

import { journeyVideoAgent } from "./agents/agent";
import { journeyVideoWorkflow } from "./workflows/workflow";

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  workflows: { journeyVideoWorkflow },
  agents: { journeyVideoAgent },
  bundler: {
    externals: [
      "@slack/web-api",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
      },
      {
        path: "/api/video/latest",
        method: "GET",
        createHandler: async () => async (c: any) => {
          const videoPath = "/tmp/journey-video/deepti-journey-video.mp4";
          if (!fs.existsSync(videoPath)) {
            return c.json({ error: "No video generated yet. Trigger the workflow first." }, 404);
          }
          const videoBuffer = fs.readFileSync(videoPath);
          const stats = fs.statSync(videoPath);
          return new Response(videoBuffer, {
            status: 200,
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(stats.size),
              "Content-Disposition": 'attachment; filename="deepti-journey-video.mp4"',
            },
          });
        },
      },
      {
        path: "/api/video/scenes",
        method: "GET",
        createHandler: async () => async (c: any) => {
          const scenesDir = "/tmp/journey-video/scenes";
          if (!fs.existsSync(scenesDir)) {
            return c.json({ error: "No scenes generated yet." }, 404);
          }
          const files = fs.readdirSync(scenesDir);
          const images = files.filter((f: string) => f.endsWith("-image.png")).sort();
          const audio = files.filter((f: string) => f.endsWith("-audio.wav")).sort();
          const segments = files.filter((f: string) => f.startsWith("segment-")).sort();
          return c.json({ images, audio, segments });
        },
      },
      {
        path: "/api/video/scene/:filename",
        method: "GET",
        createHandler: async () => async (c: any) => {
          const filename = c.req.param("filename");
          const filePath = path.join("/tmp/journey-video/scenes", filename);
          if (!fs.existsSync(filePath)) {
            return c.json({ error: "File not found" }, 404);
          }
          const fileBuffer = fs.readFileSync(filePath);
          const contentType = filename.endsWith(".png") ? "image/png"
            : filename.endsWith(".wav") ? "audio/wav"
            : filename.endsWith(".mp4") ? "video/mp4"
            : "application/octet-stream";
          return new Response(fileBuffer, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(fileBuffer.length),
            },
          });
        },
      },
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.listWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.listAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}
