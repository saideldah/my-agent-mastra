import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

let lastAnnouncement = '';

export function CopyButton({
  text,
  label,
  buttonLabel = 'Copy',
}: {
  text: string;
  label: string;
  buttonLabel?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [announcement, setAnnouncement] = useState('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    if (!text.trim()) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    let message = ok ? 'Copied' : 'Copy failed';
    if (message === lastAnnouncement) message += '\u00A0';
    lastAnnouncement = message;

    setState(ok ? 'copied' : 'failed');
    setAnnouncement('');
    window.requestAnimationFrame(() => {
      setAnnouncement(message);
    });
    timerRef.current = window.setTimeout(() => {
      setState('idle');
      setAnnouncement('');
      timerRef.current = null;
    }, 2000);
  }

  return (
    <span className="copy-wrap">
      <button
        type="button"
        className="btn btn-sm"
        aria-label={label}
        onClick={handleCopy}
        data-copied={state === 'copied' ? '' : undefined}
        data-failed={state === 'failed' ? '' : undefined}
      >
        {state === 'copied' ? (
          <Check size={14} strokeWidth={2.25} aria-hidden="true" focusable={false} />
        ) : state === 'failed' ? (
          <X size={14} strokeWidth={2.25} aria-hidden="true" focusable={false} />
        ) : (
          <Copy size={14} strokeWidth={2} aria-hidden="true" focusable={false} />
        )}
        <span>{buttonLabel}</span>
      </button>
      <span className="copy-tip" role="status">
        {announcement}
      </span>
    </span>
  );
}
