import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5433/db' });
    expect(env).toEqual({
      NODE_ENV: 'development',
      API_PORT: 3000,
      DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
    });
  });

  it('reports every invalid variable at once', () => {
    expect(() => validateEnv({ API_PORT: 'abc', NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV[\s\S]*API_PORT[\s\S]*DATABASE_URL/,
    );
  });
});
