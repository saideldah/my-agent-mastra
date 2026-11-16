# my-mastra-app

## Quick Start (Mastra Intelligence Suite)

Run the API server alongside the React interface:

```shell
# 1. Start Mastra server (port 4111)
npm run dev

# 2. In a second terminal, start the frontend workspace (port 5173)
cd weather-react-app
npm run dev
```

Sign in at [http://localhost:5173](http://localhost:5173) using the configured account credentials (`Continue with Evaluator Account`) to access:
- **Command Center** (`generative-ui-agent` streaming live operational dashboards, tables, and interactive planners)
- **Weather Advisory** (`weather-agent` interactive location choice cards + live meteorological telemetry)
- **Workspace & Schedules** (`agent` with `LocalFilesystem` / `LocalSandbox` approval gates, recurring cron schedules, and web search)
- **Decision Room** (`supervisor-agent` coordinating `Researcher → Analyzer → Writer` with specialist handoff tracking and live audits)
- **Research Pipeline** (`multi-agent-task-workflow` streaming `research-step → analyze-step → write-step` with rendered Markdown outputs and evaluation scorecards)

---

Welcome to your new [Mastra](https://mastra.ai) project! We're excited to see what you build.

This starter provides you with a general-purpose Mastra agent that can research current information, manage multi-step tasks, work with local files, run approved shell commands, and create recurring schedules.

## Features

- A local `workspace/` for files and command execution (created under `src/mastra/public/workspace/` when running `mastra dev`)
- Approval gates for file changes, deletions, and shell commands
- Conversation memory, generated thread titles, and task tracking
- Built-in web search and direct web page fetching
- Recurring schedules that persist across restarts
- Local libSQL storage and DuckDB observability, with optional Turso storage
- A bundled Mastra skill that helps coding agents use current Mastra APIs

## Get started

Set your `GOOGLE_GENERATIVE_AI_API_KEY` in `.env` or in your environment, then run:

```shell
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/studio/overview).

Select **Agent** in Mastra Studio and try one of these prompts:

- `Get the weather forecast for Austin this weekend.`
- `Create a landing page for a Japanese sakura festival.`
- `Check the SPCX stock price now, then check it every minute.`

The agent asks for approval before it changes files or runs commands. When it creates a schedule, it returns an ID that you can use to pause the schedule.

## Workspace safety

The local filesystem tools stay inside the `workspace/` directory, which resolves relative to the server's working directory (`src/mastra/public/workspace/` during `mastra dev`). Shell commands start in that directory, but `LocalSandbox` does not provide operating-system isolation by default. Review command approvals carefully, and do not expose this template through an unauthenticated public server.

## Storage

The default `file:./mastra.db` database stores agent memory, tasks, and schedules locally. To use Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.

Recurring schedules continue to use model tokens until you pause them. Ask the agent to pause a schedule with the ID returned by `start_schedule`.

## Making it yours

- Edit `src/mastra/agents/agent.ts` to change the model, instructions, memory, workspace, or approval policy.
- Edit `src/mastra/tools/` to customize scheduling.
- Edit `src/mastra/index.ts` to change storage and observability.
- Add files or reusable skills under `src/mastra/public/workspace/` for the agent to use during `mastra dev`.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). If you're new to AI agents, check out our [course](https://mastra.ai/learn) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/mastra-ai) community to get help and share your projects.

## Deploy to the Mastra platform

The [Mastra platform](https://projects.mastra.ai) provides two products for deploying and managing AI applications built with the Mastra framework. Learn more in the [Mastra platform documentation](https://mastra.ai/docs/mastra-platform/overview).

## React multi-agent demo

With the Mastra server running (`npm run dev` from this directory), start the UI:

```shell
cd weather-react-app
npm run dev
```

Open the Vite URL (normally http://localhost:5173), sign in using the demo credentials configured by `DEMO_USERNAME` / `DEMO_PASSWORD`, then scroll to **Architecture decision room**. Keep the sample PostgreSQL vs SQLite/LibSQL decision or enter your own task and audience, then click **Start agent collaboration**. The existing weather interaction remains available above it.

The UI calls `supervisor-agent.stream()` with the user's task, the audience in request context, and a fresh memory thread for each run. The supervisor's system instructions in `src/mastra/prompts/supervisor.prompt.ts` define the collaboration: Researcher → Analyzer → Researcher (evidence review) → Writer. This is LLM-directed delegation, so the actual calls can vary; the UI only displays calls that happened.

**Live agent handoffs** shows actual `tool-call` requests and `tool-result` replies, correlated by `toolCallId`. Expand **Shared context** to see the exact earlier output reused through `contextFromRefs`; raw request/result panels expose reference IDs and metadata. Specialists communicate through Supervisor, rather than making direct peer calls. The final supervisor response streams separately. Partial outputs remain visible if a run fails. Signing out or session expiry unmounts the demo and aborts the client request; **Stop receiving** also aborts it, but is not a durable server cancellation guarantee.

The UI implementation is in `weather-react-app/src/components/MultiAgentDemo.tsx`, with stream event handling in `weather-react-app/src/lib/agent-conversation.ts`. The existing supervisor and specialist configuration is in `src/mastra/agents/`.

Validate the UI and handoff handling:

```shell
node --test tests/agent-conversation.test.ts
cd weather-react-app
npm run build
```
