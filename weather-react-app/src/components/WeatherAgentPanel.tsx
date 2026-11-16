import { useState } from 'react';
import { applySpecPatch, type Spec } from '@json-render/core';
import { CheckCircle2, CloudSun, Code2, Compass, Play } from 'lucide-react';
import {
  createRobustUiStreamParser,
  GenUiSurface,
  mergeWeatherSpecWithLive,
  type WeatherData,
} from '../lib/genui-registry';
import { createMastraClient } from '../lib/mastra-client';
import { CopyButton } from './CopyButton';
import { MarkdownContent } from './MarkdownContent';
import { PayloadModal } from './PayloadModal';

interface CityOption {
  label: string;
  description?: string;
}

interface SuspendedState {
  runId: string;
  toolCallId: string;
  question: string;
  options: CityOption[];
}

const DEFAULT_CITIES: CityOption[] = [
  { label: 'San Francisco', description: 'California, USA' },
  { label: 'New York', description: 'New York, USA' },
  { label: 'London', description: 'United Kingdom' },
  { label: 'Tokyo', description: 'Japan' },
  { label: 'Paris', description: 'France' },
];

export function WeatherAgentPanel({ token }: { token: string }) {
  const [status, setStatus] = useState('Ready to initiate an interactive weather lookup.');
  const [isTriggering, setIsTriggering] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [suspended, setSuspended] = useState<SuspendedState | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>(DEFAULT_CITIES[0].label);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [agentReply, setAgentReply] = useState('');
  const [liveSpec, setLiveSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleTriggerAgent() {
    setIsTriggering(true);
    setError(null);
    setSuspended(null);
    setWeather(null);
    setAgentReply('');
    setLiveSpec(null);
    setStatus('Requesting location selection from Weather Advisory agent…');

    try {
      const weatherAgent = createMastraClient(token).getAgent('weather-agent');
      const stream = await weatherAgent.stream('Get the weather');
      if (!stream.ok) {
        throw new Error(`Weather advisory request failed (HTTP ${stream.status}).`);
      }

      let detectedRunId = '';
      let detectedToolCallId = '';
      let detectedQuestion = 'Please select a city to check the current weather:';
      let detectedOptions: CityOption[] = DEFAULT_CITIES;

      await stream.processDataStream({
        onChunk: async chunk => {
          if (chunk.runId) detectedRunId = chunk.runId;
          if (chunk.type === 'tool-call-suspended') {
            detectedToolCallId = chunk.payload.toolCallId;
            const rawPayload = (chunk.payload.suspendPayload ?? {}) as {
              question?: string;
              options?: CityOption[];
            };
            if (rawPayload.question) detectedQuestion = rawPayload.question;
            if (Array.isArray(rawPayload.options) && rawPayload.options.length > 0) {
              detectedOptions = rawPayload.options.slice(0, 5);
            }
          }
        },
      });

      if (!detectedRunId || !detectedToolCallId) {
        throw new Error('Weather advisor did not return a city selection prompt.');
      }

      setSuspended({
        runId: detectedRunId,
        toolCallId: detectedToolCallId,
        question: detectedQuestion,
        options: detectedOptions,
      });
      setSelectedCity(detectedOptions[0]?.label ?? DEFAULT_CITIES[0].label);
      setStatus('Awaiting your city selection below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start weather advisory.');
      setStatus('Error communicating with server.');
    } finally {
      setIsTriggering(false);
    }
  }

  async function consumeWeatherStream(
    streamResponse: Awaited<ReturnType<ReturnType<ReturnType<typeof createMastraClient>['getAgent']>['stream']>>,
  ): Promise<WeatherData | null> {
    let capturedWeather: WeatherData | null = null;
    let currentSpec: Spec = { root: '', elements: {} };
    const proseLines: string[] = [];

    setAgentReply('');
    setLiveSpec(null);

    const parser = createRobustUiStreamParser({
      onText: line => {
        proseLines.push(line);
        setAgentReply(proseLines.join('\n'));
      },
      onPatch: patch => {
        currentSpec = { ...applySpecPatch(currentSpec, patch) };
        setLiveSpec(currentSpec);
      },
    });

    await streamResponse.processDataStream({
      onChunk: async chunk => {
        if (chunk.type === 'text-delta') {
          parser.push(chunk.payload.text);
        }
        if (
          chunk.type === 'tool-result' &&
          typeof (chunk.payload.result as WeatherData | undefined)?.temperatureCelsius === 'number'
        ) {
          capturedWeather = chunk.payload.result as WeatherData;
          setWeather(capturedWeather);
        }
      },
    });

    parser.flush();
    return capturedWeather;
  }

  async function handleSelectCity() {
    if (!suspended) return;

    setIsResuming(true);
    setError(null);
    setWeather(null);
    setAgentReply('');
    setLiveSpec(null);
    setStatus(`Fetching live meteorological observations and advisory for ${selectedCity}…`);

    try {
      const weatherAgent = createMastraClient(token).getAgent('weather-agent');
      const resumedStream = await weatherAgent.resumeStream(selectedCity, {
        runId: suspended.runId,
        toolCallId: suspended.toolCallId,
      });
      if (!resumedStream.ok) {
        throw new Error(`Resume request failed (HTTP ${resumedStream.status}).`);
      }

      let capturedWeather = await consumeWeatherStream(resumedStream);

      if (capturedWeather === null) {
        const fallback = await weatherAgent.stream(
          `Use weatherTool to get the current weather for "${selectedCity}" right now and format the advisory dashboard.`,
        );
        if (!fallback.ok) {
          throw new Error(`Weather lookup request failed (HTTP ${fallback.status}).`);
        }
        capturedWeather = await consumeWeatherStream(fallback);
      }

      if (capturedWeather === null) {
        throw new Error(`Weather data unavailable for ${selectedCity}.`);
      }

      setStatus(`Weather advisory ready for ${selectedCity}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load weather advisory.');
      setStatus('Error fetching weather advisory.');
    } finally {
      setIsResuming(false);
    }
  }

  const step1State = isTriggering ? 'active' : suspended || weather ? 'done' : 'idle';
  const step2State = isResuming ? 'active' : weather ? 'done' : suspended ? 'active' : 'idle';
  const step3State = weather ? 'done' : isResuming ? 'active' : 'idle';

  const weatherSpec = mergeWeatherSpecWithLive(weather, liveSpec, agentReply);
  const specJson = weatherSpec ? JSON.stringify(weatherSpec, null, 2) : '';

  return (
    <div className="tabpanel-inner">
      <div className="surface-card">
        <div className="card-title-row">
          <div>
            <h2 className="section-heading">Live Weather Advisory</h2>
            <p className="section-subheading">
              Interactive location selection with live meteorological observations, apparent
              temperature comfort metrics, and travel guidance.
            </p>
          </div>
          <span className="status-pill" data-tone={isTriggering || isResuming ? 'live' : weather ? 'ok' : 'neutral'}>
            <CloudSun size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
            <span>
              {isTriggering
                ? 'Requesting'
                : isResuming
                  ? 'Streaming Advisory'
                  : weather
                    ? 'Advisory Live'
                    : suspended
                      ? 'Awaiting Choice'
                      : 'Ready'}
            </span>
          </span>
        </div>

        <ol className="stepper-list mb-5" aria-label="Weather advisory progress">
          <li className="stepper-item" data-state={step1State}>
            <span>1. Start Check</span>
          </li>
          <li className="stepper-item" data-state={step2State}>
            <span>2. Select City</span>
          </li>
          <li className="stepper-item" data-state={step3State}>
            <span>3. Live Advisory</span>
          </li>
        </ol>

        <div className="btn-row">
          <button
            id="triggerBtn"
            type="button"
            className="btn btn-primary"
            onClick={handleTriggerAgent}
            disabled={isTriggering || isResuming}
          >
            <Play size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
            <span>{isTriggering ? 'Preparing Options…' : 'Check City Weather'}</span>
          </button>

          {(suspended || weather || weatherSpec) && (
            <button type="button" className="btn" onClick={() => setModalOpen(true)}>
              <Code2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>View Telemetry Data</span>
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-[var(--ink-muted)]" role="status">
          {status}
        </p>

        {error && (
          <div className="alert-banner mt-4" data-tone="err" role="alert">
            <div>
              <strong>Error:</strong> {error}
            </div>
          </div>
        )}
      </div>

      {suspended && (
        <section id="interactionBox" className="surface-card" aria-label="City selection prompt">
          <div className="card-title-row">
            <span className="status-pill" data-tone="warn">
              <Compass size={13} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>Selection Required</span>
            </span>
          </div>

          <fieldset className="choice-fieldset">
            <legend className="choice-legend">{suspended.question}</legend>
            <div className="choice-grid">
              {suspended.options.map(opt => {
                const checked = selectedCity === opt.label;
                return (
                  <label
                    key={opt.label}
                    className={`choice-card ${checked ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="weather-city-choice"
                      value={opt.label}
                      checked={checked}
                      disabled={isResuming}
                      onChange={() => setSelectedCity(opt.label)}
                    />
                    <span>
                      <span className="choice-card-title">{opt.label}</span>
                      {opt.description && (
                        <span className="choice-card-sub">{opt.description}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="btn-row mt-4">
            <button
              id="submitCityBtn"
              type="button"
              className="btn btn-primary"
              onClick={handleSelectCity}
              disabled={isResuming}
            >
              <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" focusable={false} />
              <span>
                {isResuming
                  ? `Loading Advisory for ${selectedCity}…`
                  : `Get Weather for ${selectedCity}`}
              </span>
            </button>
          </div>
        </section>
      )}

      {(weatherSpec || agentReply) && (
        <section id="resultBox" className="surface-card" aria-label="Weather advisory result">
          <div className="card-title-row">
            <h3 className="section-heading">Meteorological Advisory</h3>
            <div className="btn-row">
              {agentReply && (
                <CopyButton text={agentReply} label="Copy weather advisory summary" />
              )}
              {specJson && (
                <CopyButton
                  text={specJson}
                  label="Copy weather telemetry JSON"
                  buttonLabel="Copy Data"
                />
              )}
            </div>
          </div>

          {agentReply && (
            <div className="mb-4">
              <MarkdownContent content={agentReply} />
            </div>
          )}

          {weatherSpec && <GenUiSurface spec={weatherSpec} loading={isResuming} />}
        </section>
      )}

      <PayloadModal
        open={modalOpen}
        title="Weather Telemetry Payload"
        payload={{
          selectedCity,
          weather,
          liveSpec,
        }}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
