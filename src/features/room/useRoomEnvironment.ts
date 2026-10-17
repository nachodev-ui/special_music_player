import { useEffect, useState } from 'react';
import settings from './room.settings.json';

export type DayPhase = 'dawn' | 'day' | 'sunset' | 'night';
export interface RoomWeather { temperature: number; code: number; cloudCover: number; sunrise: number; sunset: number; fetchedAt: number }
export const phaseLabels: Record<DayPhase, string> = { dawn: 'Amanecer', day: 'Día', sunset: 'Atardecer', night: 'Noche' };
export function weatherLabel(code: number) {
  if (code === 0) return 'Despejado';
  if (code <= 3) return 'Nublado';
  if (code <= 48) return 'Niebla';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Nieve';
  if (code >= 95) return 'Tormenta';
  return 'Lluvia';
}
function dayPhase(now: Date, weather: RoomWeather | null): DayPhase {
  const seconds = now.getTime() / 1000;
  const sameDate = (stamp: number) => new Date(stamp * 1000).toLocaleDateString('en-CA', { timeZone: settings.location.timeZone }) === now.toLocaleDateString('en-CA', { timeZone: settings.location.timeZone });
  if (weather && sameDate(weather.sunrise)) {
    if (seconds < weather.sunrise - 1800 || seconds >= weather.sunset + 1800) return 'night';
    if (seconds < weather.sunrise + 3600) return 'dawn';
    if (seconds >= weather.sunset - 3600) return 'sunset';
    return 'day';
  }
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: settings.location.timeZone }).format(now));
  return hour < 6 || hour >= 20 ? 'night' : hour < 8 ? 'dawn' : hour >= 18 ? 'sunset' : 'day';
}
export function useRoomEnvironment() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<RoomWeather | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 30000);
    const visible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => {
    if (!settings.weather.enabled) return;
    let active = true;
    let pending: AbortController | undefined;
    const refresh = async () => {
      pending?.abort();
      if (!navigator.onLine) { setWeather(null); return; }
      const controller = pending = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), settings.weather.timeoutMs);
      try {
        const query = new URLSearchParams({ latitude: String(settings.location.latitude), longitude: String(settings.location.longitude), current: 'temperature_2m,weather_code,cloud_cover', daily: 'sunrise,sunset', timezone: settings.location.timeZone, timeformat: 'unixtime', forecast_days: '1' });
        const response = await fetch('https://api.open-meteo.com/v1/forecast?' + query, { signal: controller.signal });
        if (!response.ok) throw new Error('Weather unavailable');
        const data = await response.json();
        const values = [data.current?.temperature_2m, data.current?.weather_code, data.current?.cloud_cover, data.daily?.sunrise?.[0], data.daily?.sunset?.[0]];
        if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Invalid weather');
        if (active && pending === controller) setWeather({ temperature: values[0], code: values[1], cloudCover: values[2], sunrise: values[3], sunset: values[4], fetchedAt: Date.now() });
      } catch { if (active && pending === controller) setWeather(null); }
      finally { window.clearTimeout(timeout); }
    };
    const offline = () => { pending?.abort(); pending = undefined; setWeather(null); };
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(1, settings.weather.refreshMinutes) * 60000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', offline);
    return () => { active = false; pending?.abort(); window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('offline', offline); };
  }, []);
  // A sleeping window must not keep showing stale weather after waking up.
  const freshWeather = weather && now.getTime() - weather.fetchedAt < settings.weather.refreshMinutes * 120000 ? weather : null;
  return { now, weather: freshWeather, phase: dayPhase(now, freshWeather), location: settings.location };
}
