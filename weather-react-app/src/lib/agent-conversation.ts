export interface Delegation {
  id: string;
  agent: string;
  request: unknown;
  result?: unknown;
  status: 'working' | 'complete' | 'failed' | 'interrupted';
}

export const SPECIALISTS: Record<string, string> = {
  'agent-researcherAgent': 'Researcher',
  'agent-analyzerAgent': 'Analyzer',
  'agent-writerAgent': 'Writer',
};

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function displayMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  const data = record(value);
  if (typeof data.text === 'string') return data.text;
  if (typeof data.message === 'string') return data.message;
  return JSON.stringify(value, null, 2) ?? '';
}

export function sharedContext(request: unknown, delegations: Delegation[]): Delegation[] {
  const refs = record(request).contextFromRefs;
  if (!Array.isArray(refs)) return [];
  const ids = refs.map(ref => typeof ref === 'string' ? ref : record(ref).ref);
  return delegations.filter(item => item.result !== undefined && ids.includes(record(item.result).ref));
}

// Correlate by toolCallId, not agent name: the supervisor can revisit a specialist.
export function updateDelegations(current: Delegation[], event: unknown): Delegation[] {
  const chunk = record(event);
  const payload = record(chunk.payload);
  const agent = SPECIALISTS[String(payload.toolName)];
  if (!agent || typeof payload.toolCallId !== 'string') return current;
  const id = payload.toolCallId;
  if (chunk.type === 'tool-call') {
    if (current.some(item => item.id === id)) return current;
    return [...current, { id, agent, request: payload.args, status: 'working' }];
  }
  if (chunk.type === 'tool-result') {
    const result = record(payload.result);
    return current.map(item => item.id === id ? {
      ...item,
      result: payload.result,
      status: payload.isError || result.success === false || result.error ? 'failed'
        : payload.preliminary ? 'working' : 'complete',
    } : item);
  }
  return current;
}
