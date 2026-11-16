import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeChoice = 'light' | 'dark' | 'system';

function readStoredTheme(): ThemeChoice {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // Ignore storage access restrictions
  }
  return 'system';
}

function applyThemeChoice(choice: ThemeChoice) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  const content = choice === 'system' ? 'light dark' : choice;
  if (meta) meta.content = content;
  try {
    localStorage.setItem('color-scheme-initialized', '1');
    if (choice === 'system') {
      localStorage.removeItem('color-scheme');
    } else {
      localStorage.setItem('color-scheme', choice);
    }
  } catch {
    // Theme still applies to current session even if storage is blocked
  }
}

export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'color-scheme') return;
      const next = readStoredTheme();
      setChoice(next);
      const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
      if (meta) meta.content = next === 'system' ? 'light dark' : next;
    };

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (readStoredTheme() === 'system') {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
        if (meta) meta.content = 'light dark';
      }
    };

    window.addEventListener('storage', onStorage);
    media.addEventListener('change', onMediaChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      media.removeEventListener('change', onMediaChange);
    };
  }, []);

  function select(next: ThemeChoice) {
    setChoice(next);
    applyThemeChoice(next);
  }

  return (
    <fieldset className="theme-fieldset">
      <legend className="visually-hidden">Color scheme preference</legend>
      <button
        type="button"
        className="theme-option"
        aria-pressed={choice === 'light'}
        onClick={() => select('light')}
      >
        <Sun size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
        <span>Light</span>
      </button>
      <button
        type="button"
        className="theme-option"
        aria-pressed={choice === 'dark'}
        onClick={() => select('dark')}
      >
        <Moon size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
        <span>Dark</span>
      </button>
      <button
        type="button"
        className="theme-option"
        aria-pressed={choice === 'system'}
        onClick={() => select('system')}
      >
        <Monitor size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
        <span>System</span>
      </button>
    </fieldset>
  );
}
