import { render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the app name from @creditflow/shared and the API status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'CreditFlow' })).toBeInTheDocument();
    expect(await screen.findByText('disponível')).toBeInTheDocument();
  });

  it('reports the API as unavailable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    render(<App />);
    expect(await screen.findByText('indisponível')).toBeInTheDocument();
  });
});
