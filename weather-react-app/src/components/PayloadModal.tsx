import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { CopyButton } from './CopyButton';

export function PayloadModal({
  open,
  title,
  payload,
  onClose,
}: {
  open: boolean;
  title: string;
  payload: unknown;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const formatted =
    typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}, null, 2);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };

    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss for browsers without native closedby support (e.g. Safari)
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) dialog.close();
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      return () => {
        dialog.removeEventListener('close', handleClose);
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="payload-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="dialog-header">
        <h2 id={titleId} className="section-heading">
          {title}
        </h2>
        <div className="btn-row">
          <CopyButton text={formatted} label={`Copy ${title} JSON`} buttonLabel="Copy JSON" />
          <button
            type="button"
            className="btn btn-sm"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            aria-label={`Close ${title} dialog`}
          >
            <X size={15} strokeWidth={2.25} aria-hidden="true" focusable={false} />
            <span>Close</span>
          </button>
        </div>
      </div>
      <div className="dialog-body">
        <pre className="code-pre code-scroll" tabIndex={0}>
          {formatted}
        </pre>
      </div>
    </dialog>
  );
}
