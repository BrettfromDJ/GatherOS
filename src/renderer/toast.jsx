import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Toast from './components/Toast.jsx';

const TOAST_TTL_MS = 2500;

function ToastStack() {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());

  useEffect(() => {
    return window.toast.onShow((record) => {
      const id = ++seq.current;
      setToasts((prev) => [...prev, { id, record }]);
      const t = setTimeout(() => dismiss(id), TOAST_TTL_MS);
      timers.current.set(id, t);
    });
  }, []);

  function dismiss(id) {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }

  // Let the OS-level window forward mouse events when there's something to click.
  useEffect(() => {
    window.toast.setInteractive(toasts.length > 0);
    if (toasts.length === 0) window.toast.empty();
  }, [toasts.length]);

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        bottom: 0,
        right: 0,
        padding: 16,
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          record={t.record}
          onDismiss={() => {
            window.toast.openImage(t.record.file_path);
            dismiss(t.id);
          }}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ToastStack />);
