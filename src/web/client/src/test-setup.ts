import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so RTL can't register its own cleanup.
afterEach(cleanup);
