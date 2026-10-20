import { describe, expect, it } from 'vitest';
import { cleanAllocation } from './db';
import type { AllocationConfig } from '../domain/types';

describe('stored allocation config', () => {
  it('a config saved by the previous version (trends, no fx) loads without rates', () => {
    const old = { trends: { RUB: -0.08 }, targets: [{ class: 'Fixed Income', target: 0.3 }], limits: [] } as unknown as AllocationConfig;
    expect(cleanAllocation(old)).toEqual({ targets: [{ class: 'Fixed Income', target: 0.3 }], limits: [], fx: undefined });
  });
  it('keeps valid fx points and drops broken ones', () => {
    const raw = {
      targets: [],
      limits: [],
      fx: {
        ytd: { start: '2026-01-01', rates: { rub: { date: '2025-12-31', usd: 0.0126 }, TRY: { date: 'x', usd: 1 }, GEL: { date: '2026-01-01', usd: 0 } } },
        y1: { start: '2025-10-19', rates: {} },
        now: { RUB: { date: '2026-10-18', usd: '0.0119' } },
      },
    } as unknown as AllocationConfig;
    expect(cleanAllocation(raw).fx).toEqual({
      ytd: { start: '2026-01-01', rates: { RUB: { date: '2025-12-31', usd: 0.0126 } } },
      y1: { start: '2025-10-19', rates: {} },
      now: { RUB: { date: '2026-10-18', usd: 0.0119 } },
    });
  });
});
