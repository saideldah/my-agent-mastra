import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createMastraClient } from '../lib/mastra-client';
import { displayMessage, record, sharedContext, updateDelegations } from '../lib/agent-conversation';
import type { Delegation } from '../lib/agent-conversation';

const EXAMPLE = 'We are building a customer-support assistant for a small engineering team. Compare PostgreSQL and SQLite/LibSQL for storing conversations and agent state. We expect 100 concurrent users, need auditability, and prefer low operational overhead. Recommend an approach and a small validation plan.';

export default function MultiAgentDemo({ token }: { token: string }) {
  const [task, setTask] = useState(EXAMPLE);
  const [audience, setAudience] = useState('Engineering leadership');
  const [running, setRunning] = useState(false);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [reply, setReply] = useState('');
  const [runId, setRunId] = useState('');
  const [status, setStatus] = useState('Ready to start the team.');
  const [error, setError] = useState('');
  const activeRun = useRef<AbortController | null>(null);

  useEffect(() => () => { activeRun.current?.abort(); }, [token]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRun.current) return;
    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setDelegations([]);
    setReply('');
    setRunId('');
    setError('');
    setStatus('Supervisor is planning the task...');
    let finalText = '';
    let calls: Delegation[] = [];
    let finishReason = '';
    let finished = false;
    let streamError = '';
    try {
      const stream = await createMastraClient(token, controller.signal)
        .getAgent('supervisor-agent').stream(
          task.trim(),
          {
            memory: { thread: crypto.randomUUID(), resource: 'demo-user' },
            requestContext: { audience: audience.trim() },
          },
        );
      if (!stream.ok) throw new Error(`Unable to start the team (HTTP ${stream.status}). Sign in again if your session expired.`);
      await stream.processDataStream({
        onChunk: async chunk => {
          if (controller.signal.aborted) return;
          if (chunk.runId) setRunId(chunk.runId);
          const event = record(chunk);
          const payload = record(event.payload);
          if (chunk.type === 'error') {
            streamError = displayMessage(payload.error) || 'The agent run failed.';
            setError(streamError);
          }
          if (chunk.type === 'finish') {
            finished = true;
            finishReason = String(record(payload.stepResult).reason ?? payload.finishReason ?? '');
          }
          calls = updateDelegations(calls, chunk);
          setDelegations(calls);
          if (chunk.type === 'tool-call') {
            // Supervisor text before a delegation is progress, not the final report.
            finalText = '';
            setReply('');
            setStatus('The team is working. Open a handoff to inspect the messages.');
          }
          if (chunk.type === 'text-delta') {
            finalText += chunk.payload.text;
            setReply(finalText);
          }
        },
      });
      if (controller.signal.aborted) return;
      if (streamError) throw new Error(streamError);
      if (!finished || !finalText.trim() || calls.some(call => call.status === 'working') || ['error', 'length', 'content-filter', 'tripwire'].includes(finishReason)) {
        throw new Error('The run ended before a complete report was returned. Review the handoffs and try again.');
      }
      setStatus(calls.some(call => call.status === 'failed')
        ? 'Finished with a failed delegation. Review the handoffs and report limitations.'
        : calls.length ? 'Team finished. The actual requests and replies are shown below.'
        : 'Supervisor replied without delegating. Try again to see team collaboration.');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'The team run failed.');
      setStatus('Run interrupted. Any partial messages are preserved below.');
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
        setDelegations(items => items.map(item => item.status === 'working' ? { ...item, status: 'interrupted' } : item));
      }
    }
  }

  function stop() {
    activeRun.current?.abort();
    setStatus('Stopped receiving the run. Server work may already have completed.');
  }

  return (
    <section className="team-demo" aria-labelledby="team-heading">
      <div className="badge">Multi-agent collaboration</div>
      <h2 id="team-heading">Architecture decision room</h2>
      <p className="subtitle">Researcher gathers evidence, Analyzer challenges it, Researcher checks the challenges, and Writer drafts a decision brief. Supervisor routes each handoff.</p>
      <div className="team-flow" aria-label="Agent communication path">Supervisor ↔ Researcher · Supervisor ↔ Analyzer · Supervisor ↔ Writer</div>
      <form onSubmit={start} className="team-form">
        <label htmlFor="team-task">Decision to investigate</label>
        <textarea id="team-task" value={task} onChange={event => setTask(event.target.value)} required maxLength={6000} rows={5} disabled={running} />
        <label htmlFor="team-audience">Audience</label>
        <input id="team-audience" value={audience} onChange={event => setAudience(event.target.value)} required maxLength={150} disabled={running} />
        <button className="primary-btn" disabled={running || !task.trim() || !audience.trim()}>{running ? 'Team is working...' : 'Start agent collaboration'}</button>
        {running && <button type="button" className="secondary-btn" onClick={stop}>Stop receiving</button>}
      </form>
      <p className="status" role="status">{status}</p>
      {runId && <p className="run-id">Run: {runId}</p>}
      {error && <div className="error-box" role="alert">{error}</div>}
      {delegations.length > 0 && <>
        <h3>Live agent handoffs</h3>
        <p className="subtitle">These are the actual requests and returned outputs. Expand raw payloads to inspect contextFromRefs and result metadata. Communication is routed through Supervisor.</p>
        <ol className="handoff-list">{delegations.map(item => (
          <li key={item.id} className="step-box">
            <div className="step-header"><strong>Supervisor → {item.agent}</strong><span className={`pill ${item.status}`}>{item.status}</span></div>
            <details open><summary>Delegation request</summary><pre>{typeof record(item.request).prompt === 'string' ? String(record(item.request).prompt) : displayMessage(item.request)}</pre></details>
            <details><summary>Raw request, including context references</summary><pre>{JSON.stringify(item.request, null, 2)}</pre></details>
            {sharedContext(item.request, delegations).map(source => (
              <details key={source.id}>
                <summary>Shared context: {source.agent} → {item.agent} ({String(record(source.result).ref)})</summary>
                <pre>{displayMessage(source.result)}</pre>
              </details>
            ))}
            {item.result !== undefined && <>
              <h4>{item.agent} → Supervisor</h4>
              <details open><summary>Specialist reply</summary><pre>{displayMessage(item.result)}</pre></details>
              <details><summary>Raw result</summary><pre>{JSON.stringify(item.result, null, 2)}</pre></details>
            </>}
          </li>
        ))}</ol>
      </>}
      {reply && <div className="step-box"><h3>{running ? 'Supervisor response (streaming)' : 'Supervisor response'}</h3><div className="agent-reply">{reply}</div></div>}
    </section>
  );
}
