import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayMessage, sharedContext, updateDelegations } from '../weather-react-app/src/lib/agent-conversation.ts';

const call = (id: string, refs: string[] = []) => ({ type: 'tool-call', payload: {
  toolCallId: id, toolName: 'agent-researcherAgent', args: { prompt: 'Check evidence', contextFromRefs: refs },
} });
const result = (id: string, extra = {}) => ({ type: 'tool-result', payload: {
  toolCallId: id, toolName: 'agent-researcherAgent', result: { text: 'Verified evidence' }, ...extra,
} });

test('repeated calls to one specialist remain separate and preserve reference handoffs', () => {
  let state = updateDelegations([], call('research-1'));
  state = updateDelegations(state, result('research-1'));
  state = updateDelegations(state, call('research-2', ['analyzer-1']));
  assert.equal(state.length, 2);
  assert.equal(state[0].status, 'complete');
  assert.equal(state[1].status, 'working');
  assert.deepEqual(state[1].request, { prompt: 'Check evidence', contextFromRefs: ['analyzer-1'] });
  state = updateDelegations(state, result('research-2'));
  assert.ok(state.every(item => item.status === 'complete'));
});

test('duplicate calls and nested tool activity do not create false agent messages', () => {
  const state = updateDelegations([], call('one'));
  assert.equal(updateDelegations(state, call('one')), state);
  assert.equal(updateDelegations(state, { type: 'tool-call', payload: { toolCallId: 'web', toolName: 'web_search' } }), state);
  assert.equal(updateDelegations(state, { type: 'data-tool-agent', payload: call('nested') }), state);
});

test('failed and preliminary results are never shown as successfully completed', () => {
  const state = updateDelegations([], call('one'));
  assert.equal(updateDelegations(state, result('one', { isError: true }))[0].status, 'failed');
  assert.equal(updateDelegations(state, result('one', { result: { success: false, text: 'Failed' } }))[0].status, 'failed');
  assert.equal(updateDelegations(state, result('one', { preliminary: true }))[0].status, 'working');
});

test('messages expose actual specialist text and preserve structured payloads', () => {
  assert.equal(displayMessage({ text: 'Evidence', metadata: {} }), 'Evidence');
  assert.equal(displayMessage('Plain text'), 'Plain text');
  assert.match(displayMessage({ error: 'Failed' }), /Failed/);
});

test('shared context resolves string and labeled references to the actual earlier outputs', () => {
  let state = updateDelegations([], call('one'));
  state = updateDelegations(state, result('one', { result: { text: 'Actual findings', ref: 'researcher-1' } }));
  assert.deepEqual(sharedContext({ contextFromRefs: ['researcher-1'] }, state), state);
  assert.deepEqual(sharedContext({ contextFromRefs: [{ ref: 'researcher-1', as: 'evidence' }] }, state), state);
  assert.deepEqual(sharedContext({ contextFromRefs: ['missing-ref'] }, state), []);
});
