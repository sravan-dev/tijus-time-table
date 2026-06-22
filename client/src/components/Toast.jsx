import { createContext, useCallback, useContext, useState } from 'react';

// Lightweight app-wide toast notifications. Wrap the app in <ToastProvider> and
// call the function from useToast(): toast('Saved') or toast('Failed', 'error').
const ToastCtx = createContext(() => {});
let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message, type = 'success') => {
    const id = ++seq;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => remove(id), 3000);
  }, [remove]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.type} onClick={() => remove(t.id)} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
