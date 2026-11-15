import { Mastra } from '@mastra/core/mastra';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import {
  MastraPlatformExporter,
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import {
  agent,
  analyzerAgent,
  researcherAgent,
  supervisorAgent,
  weatherAgent,
  writerAgent,
} from './agents';
import { authRoutes, demoAuth } from './auth';
import { registeredScorers } from './evals/scorers';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { weatherTool } from './tools/weather-tool';
import { multiAgentTaskWorkflow } from './workflows';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: {
    agent,
    weatherAgent,
    supervisorAgent,
    researcherAgent,
    analyzerAgent,
    writerAgent,
  },
  workflows: {
    multiAgentTaskWorkflow,
  },
  tools: {
    startScheduleTool,
    stopScheduleTool,
    weatherTool,
  },
  scorers: registeredScorers,
  server: {
    auth: demoAuth,
    apiRoutes: authRoutes,
    cors: {
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-mastra-client-type'],
    },
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

await mastra.schedules.delete('weather-email-every-5m');
