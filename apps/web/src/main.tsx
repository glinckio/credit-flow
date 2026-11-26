import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { AppProviders } from './app/providers';
import { routes } from './app/routes';
import './index.css';
import { createQueryClient } from './lib/query-client';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

createRoot(root).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
