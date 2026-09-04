import { describe, expect, it } from 'bun:test';
import { ApiError, type ApiClient } from '../../lib/client';
import { pollExperiment, pollRun } from './shared';

describe('agent polling helpers', () => {
  it('polls newly-created runs through the primary-backed execution expansion', async () => {
    const paths: string[] = [];
    const client = {
      get: async (path: string) => {
        paths.push(path);
        if (paths.length === 1) {
          return { id: 'run_1', finished: true, execution: { status: 'completed' } };
        }
        return { id: 'run_1', finished: true, execution: { status: 'completed' }, output: {} };
      },
    } as unknown as ApiClient;

    const result = await pollRun(client, 'run_1', 0, 1);

    expect(result).toMatchObject({ id: 'run_1', output: {} });
    expect(paths).toEqual([
      '/v1/runs/run_1?expand=execution',
      '/v1/runs/run_1?expand=usage,execution',
    ]);
  });

  it('retries a short experiment visibility race', async () => {
    let calls = 0;
    const client = {
      get: async () => {
        calls++;
        if (calls < 3) throw new ApiError(404, { error: 'Experiment not found' });
        return { id: 'batch_1', status: 'completed' };
      },
    } as unknown as ApiClient;

    await expect(pollExperiment(client, 'agents.support', 'batch_1', 0, 1)).resolves.toMatchObject({
      id: 'batch_1',
      status: 'completed',
    });
    expect(calls).toBe(3);
  });
});
