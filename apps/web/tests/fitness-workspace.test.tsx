import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FitnessWorkspace } from '@/components/fitness/fitness-workspace';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FitnessWorkspace', () => {
  it('records an explicit local check-in before showing a recovery recommendation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            signal: {
              id: '00000000-0000-4000-8000-000000000211',
              localDate: '2026-08-17',
              kind: 'RECOVERY',
              value: 25,
              source: 'CHECK_IN',
              version: 1,
              createdAt: '2026-08-17T01:00:00.000Z',
              updatedAt: '2026-08-17T01:00:00.000Z',
            },
            assessment: {
              score: 25,
              level: 'CAUTION',
              reasons: ['睡眠不足', '存在较高程度的不适'],
            },
          },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<FitnessWorkspace initialDate="2026-08-17" />);

    await user.clear(screen.getByLabelText('睡眠时长（小时）'));
    await user.type(screen.getByLabelText('睡眠时长（小时）'), '5');
    await user.selectOptions(screen.getByLabelText('主观精力（1–5）'), '2');
    await user.selectOptions(screen.getByLabelText('不适程度（0–5）'), '4');
    await user.click(screen.getByRole('button', { name: '保存本地打卡' }));

    expect(await screen.findByText('注意恢复')).toBeInTheDocument();
    expect(screen.getByText('睡眠不足')).toBeInTheDocument();
    expect(screen.getByText('本结果仅用于安排负载，不构成医疗诊断。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/check-ins',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ localDate: '2026-08-17', sleepHours: 5, energy: 2, discomfort: 4 }),
      }),
    );
  });
});
