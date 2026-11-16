import { pathToFileURL } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
import { askUserTool, webFetchTool } from '@mastra/core/tools';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { Memory } from '@mastra/memory';
import { getWorkspaceAgentInstructions } from '../genui/catalog';
import { DEFAULT_AGENT_MODEL } from '../prompts/shared-blocks';
import { openWebSearchTool } from '../tools/open-web-search.tool';
import { startScheduleTool, stopScheduleTool } from '../tools/schedule-tools';
import { weatherTool } from '../tools/weather-tool';

const workspacePath = 'workspace';

const workspace = new Workspace({
  id: 'agent-workspace',
  name: 'Agent Workspace',
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: workspacePath,
  }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
    [WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]: {
      requireApproval: true,
    },
  },
});

export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  description:
    'A general-purpose workspace assistant that researches topics, manages local files, runs approved commands, and manages recurring schedules.',
  metadata: {
    suggestedPrompts: [
      "What's the weather in Austin this weekend?",
      'Create a project readiness checklist in the local workspace and visualize its artifacts.',
      'Start an every-10-minute schedule to check weather, then show the active ScheduleCard.',
    ],
  },
  instructions: getWorkspaceAgentInstructions(pathToFileURL(`${workspacePath}/`).href),
  model: DEFAULT_AGENT_MODEL,
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: DEFAULT_AGENT_MODEL,
      },
    },
  }),
  workspace,
  tools: {
    ask_user: askUserTool,
    start_schedule: startScheduleTool,
    stop_schedule: stopScheduleTool,
    web_fetch: webFetchTool,
    web_search: openWebSearchTool,
    weatherTool,
  },
  signals: [new TaskSignalProvider()],
});
