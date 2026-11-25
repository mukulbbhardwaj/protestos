import { createBrowserRouter } from 'react-router-dom';
import { LandingPage } from '@/pages/landing/LandingPage';

/** Landing-only deployments serve just the public page, with no API calls. */
export const router = createBrowserRouter([{ path: '*', element: <LandingPage /> }]);
