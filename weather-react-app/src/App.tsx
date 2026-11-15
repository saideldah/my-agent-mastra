import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createMastraClient, MASTRA_BASE_URL } from './lib/mastra-client';
import MultiAgentDemo from './components/MultiAgentDemo';

interface CityOption {
  label: string;
  description?: string;
}

interface WeatherData {
  location: string;
  temperatureCelsius: number;
  feelsLikeCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  conditions: string;
  observedAt: string;
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

export default function App() {
  const [session, setSession] = useState<{ token: string; expiresAt: number } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [status, setStatus] = useState<string>('Sign in to try the agent demos.');
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [isResuming, setIsResuming] = useState<boolean>(false);
  const [suspended, setSuspended] = useState<SuspendedState | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>(DEFAULT_CITIES[0].label);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [agentReply, setAgentReply] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      setSession(null);
      setSuspended(null);
      setWeather(null);
      setAgentReply('');
      setStatus('Your session expired. Sign in again.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    try {
      const response = await fetch(`${MASTRA_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Sign-in failed.');
      setSession({
        token: result.accessToken,
        expiresAt: Date.now() + result.expiresIn * 1000,
      });
      setPassword('');
      setStatus('Signed in. Try the weather agent or start a team collaboration below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    if (!session) return;
    setError(null);
    try {
      const response = await fetch(`${MASTRA_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok && response.status !== 401) {
        throw new Error('Sign-out failed. Try again.');
      }
      setSession(null);
      setSuspended(null);
      setWeather(null);
      setAgentReply('');
      setStatus('Signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  }

  // Step 1: Trigger the Mastra agent via @mastra/client-js
  async function handleTriggerAgent() {
    if (!session) return;
    setIsTriggering(true);
    setError(null);
    setSuspended(null);
    setWeather(null);
    setAgentReply('');
    setStatus('Calling weatherAgent.stream("Get the weather") on Mastra server...');

    try {
      const weatherAgent = createMastraClient(session.token).getAgent('weather-agent');
      const stream = await weatherAgent.stream('Get the weather');

      let detectedRunId = '';
      let detectedToolCallId = '';
      let detectedQuestion = 'Please select a city to check the current weather:';
      let detectedOptions: CityOption[] = DEFAULT_CITIES;

      await stream.processDataStream({
        onChunk: async chunk => {
          if (chunk.runId) {
            detectedRunId = chunk.runId;
          }
          if (chunk.type === 'tool-call-suspended') {
            detectedToolCallId = chunk.payload.toolCallId;
            const rawPayload = (chunk.payload.suspendPayload ?? {}) as {
              question?: string;
              options?: CityOption[];
            };
            if (rawPayload.question) {
              detectedQuestion = rawPayload.question;
            }
            if (Array.isArray(rawPayload.options) && rawPayload.options.length > 0) {
              detectedOptions = rawPayload.options.slice(0, 5);
            }
          }
        },
      });

      setSuspended({
        runId: detectedRunId,
        toolCallId: detectedToolCallId,
        question: detectedQuestion,
        options: detectedOptions,
      });
      setSelectedCity(detectedOptions[0]?.label ?? DEFAULT_CITIES[0].label);
      setStatus(
        `Agent suspended (runId: ${detectedRunId.slice(0, 8)}…) waiting for your city selection.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger agent';
      setError(message);
      setStatus('Error communicating with Mastra server.');
    } finally {
      setIsTriggering(false);
    }
  }

  // Step 2: Resume the suspended agent run with the selected city
  async function handleSelectCity() {
    if (!suspended || !session) return;

    setIsResuming(true);
    setError(null);
    setWeather(null);
    setAgentReply('');
    setStatus(`Resuming suspended run with city "${selectedCity}"...`);

    try {
      const weatherAgent = createMastraClient(session.token).getAgent('weather-agent');
      const resumedStream = await weatherAgent.resumeStream(selectedCity, {
        runId: suspended.runId,
        toolCallId: suspended.toolCallId,
      });

      await resumedStream.processDataStream({
        onChunk: async chunk => {
          if (chunk.type === 'text-delta') {
            setAgentReply(prev => prev + chunk.payload.text);
          }
          if (
            chunk.type === 'tool-result' &&
            (chunk.payload.toolName === 'weatherTool' ||
              chunk.payload.toolName === 'get-weather')
          ) {
            setWeather(chunk.payload.result as WeatherData);
          }
        },
      });

      setStatus(`Completed weather check for ${selectedCity}!`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume agent';
      setError(message);
      setStatus('Error resuming agent run.');
    } finally {
      setIsResuming(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="badge">Standalone React + Vite App</div>
        <h1>Agent Playground</h1>
        <p className="subtitle">
          Connected to Mastra Server at <code>{MASTRA_BASE_URL}</code> via{' '}
          <code>@mastra/client-js</code>
        </p>

        {!session ? (
          <form className="login-form" onSubmit={handleLogin}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              required
              disabled={isLoggingIn}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              disabled={isLoggingIn}
            />
            <button className="primary-btn" type="submit" disabled={isLoggingIn}>
              {isLoggingIn ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <button
            className="secondary-btn sign-out"
            onClick={handleLogout}
            disabled={isTriggering || isResuming}
          >
            Sign out
          </button>
        )}

        <button
          id="triggerBtn"
          className="primary-btn"
          onClick={handleTriggerAgent}
          disabled={!session || isTriggering || isResuming}
        >
          {isTriggering ? 'Triggering Agent...' : 'Trigger Weather Agent'}
        </button>

        {suspended && (
          <div id="interactionBox" className="step-box">
            <div className="step-header">
              <span className="pill">Tool Suspended: ask_user</span>
              <span className="run-id">runId: {suspended.runId.slice(0, 8)}…</span>
            </div>
            <label htmlFor="citySelect" className="question-label">
              {suspended.question}
            </label>
            <select
              id="citySelect"
              value={selectedCity}
              onChange={e => setSelectedCity(e.target.value)}
              disabled={isResuming}
            >
              {suspended.options.map(opt => (
                <option key={opt.label} value={opt.label}>
                  {opt.description ? `${opt.label} (${opt.description})` : opt.label}
                </option>
              ))}
            </select>

            <button
              id="submitCityBtn"
              className="secondary-btn"
              onClick={handleSelectCity}
              disabled={isResuming}
            >
              {isResuming
                ? `Fetching Weather for ${selectedCity}...`
                : 'Get Weather for Selected City'}
            </button>
          </div>
        )}

        {(weather || agentReply) && (
          <div id="resultBox" className="step-box">
            {weather && (
              <div className="weather-grid">
                <div className="metric">
                  <div className="k">Location</div>
                  <div className="v">{weather.location}</div>
                </div>
                <div className="metric">
                  <div className="k">Conditions</div>
                  <div className="v">{weather.conditions}</div>
                </div>
                <div className="metric">
                  <div className="k">Temperature</div>
                  <div className="v">
                    {weather.temperatureCelsius}°C (Feels {weather.feelsLikeCelsius}°C)
                  </div>
                </div>
                <div className="metric">
                  <div className="k">Humidity / Wind</div>
                  <div className="v">
                    {weather.humidityPercent}% · {weather.windSpeedKmh} km/h
                  </div>
                </div>
              </div>
            )}
            {agentReply && <div className="agent-reply">{agentReply}</div>}
          </div>
        )}

        {error && <div className="error-box">Error: {error}</div>}
        <div className="status">{status}</div>
        {session && <MultiAgentDemo token={session.token} />}
      </div>
    </div>
  );
}
