import { useEffect, useState } from 'react';
import { APP_NAME } from '@creditflow/shared';

type ApiState = 'checking' | 'online' | 'offline';

/**
 * Stage 1 placeholder: proves the web app builds, imports @creditflow/shared
 * and reaches the API through the Vite proxy. Replaced by the real layout in Stage 9.
 */
export function App() {
  const [apiState, setApiState] = useState<ApiState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/health', { signal: controller.signal })
      .then((res) => setApiState(res.ok ? 'online' : 'offline'))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setApiState('offline');
      });
    return () => controller.abort();
  }, []);

  const label: Record<ApiState, string> = {
    checking: 'verificando…',
    online: 'disponível',
    offline: 'indisponível',
  };

  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>Gestão e análise manual de crédito. Ambiente com dados sintéticos.</p>
      <p>
        API: <strong data-testid="api-status">{label[apiState]}</strong>
      </p>
    </main>
  );
}
