import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const WEATHER_CITIES = [
  { label: 'San Francisco', description: 'California, United States' },
  { label: 'New York', description: 'New York, United States' },
  { label: 'London', description: 'United Kingdom' },
  { label: 'Tokyo', description: 'Japan' },
  { label: 'Paris', description: 'France' },
] as const;

interface GeocodingResponse {
  results?: {
    latitude: number;
    longitude: number;
    name: string;
    country?: string;
  }[];
}

interface WeatherResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    weather_code: number;
  };
}

const WEATHER_CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export const weatherTool = createTool({
  id: 'get-weather',
  description: 'Fetch current weather conditions for a selected city using the Open-Meteo API.',
  inputSchema: z.object({
    location: z
      .string()
      .describe('City name selected by the user (e.g. San Francisco, New York, London, Tokyo, Paris).'),
  }),
  outputSchema: z.object({
    location: z.string(),
    temperatureCelsius: z.number(),
    feelsLikeCelsius: z.number(),
    humidityPercent: z.number(),
    windSpeedKmh: z.number(),
    conditions: z.string(),
    observedAt: z.string(),
  }),
  execute: async ({ location }, { abortSignal }) => {
    const targetCity = location.trim();

    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(targetCity)}&count=1`;
    const geoResponse = await fetch(geoUrl, { signal: abortSignal });
    if (!geoResponse.ok) {
      throw new Error(`Geocoding request failed with status ${geoResponse.status}`);
    }

    const geoData = (await geoResponse.json()) as GeocodingResponse;
    const match = geoData.results?.[0];
    if (!match) {
      throw new Error(`Location '${targetCity}' not found.`);
    }

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${match.latitude}&longitude=${match.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`;
    const weatherResponse = await fetch(weatherUrl, { signal: abortSignal });
    if (!weatherResponse.ok) {
      throw new Error(`Weather request failed with status ${weatherResponse.status}`);
    }

    const weatherData = (await weatherResponse.json()) as WeatherResponse;
    const resolvedLocation = match.country ? `${match.name}, ${match.country}` : match.name;

    return {
      location: resolvedLocation,
      temperatureCelsius: weatherData.current.temperature_2m,
      feelsLikeCelsius: weatherData.current.apparent_temperature,
      humidityPercent: weatherData.current.relative_humidity_2m,
      windSpeedKmh: weatherData.current.wind_speed_10m,
      conditions: WEATHER_CONDITIONS[weatherData.current.weather_code] ?? 'Unknown',
      observedAt: weatherData.current.time,
    };
  },
});
