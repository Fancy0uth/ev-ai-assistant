import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NutritionWorkspace } from '@/components/nutrition/nutrition-workspace';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('NutritionWorkspace', () => {
  it('stores only a user-confirmed meal record with transparent nutrition values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            id: '00000000-0000-4000-8000-000000000311', localDate: '2026-08-17',
            entries: [{ name: '鸡胸肉', grams: 200, calories: 330, proteinGrams: 62, carbohydrateGrams: 0, fatGrams: 7 }],
            totals: { calories: 330, proteinGrams: 62, carbohydrateGrams: 0, fatGrams: 7 },
            createdAt: '2026-08-17T02:00:00.000Z',
          },
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<NutritionWorkspace initialDate="2026-08-17" />);

    await user.type(screen.getByLabelText('食物名称'), '鸡胸肉');
    await user.clear(screen.getByLabelText('重量（克）'));
    await user.type(screen.getByLabelText('重量（克）'), '200');
    await user.type(screen.getByLabelText('热量（千卡）'), '330');
    await user.type(screen.getByLabelText('蛋白质（克）'), '62');
    await user.click(screen.getByRole('button', { name: '确认并保存这餐' }));

    expect(await screen.findByText('本餐已确认')).toBeInTheDocument();
    expect(screen.getByText('330 kcal · 蛋白质 62 g')).toBeInTheDocument();
    expect(screen.getByText('系统不会把未经你确认的模型猜测写入饮食记录。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/core/meals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          localDate: '2026-08-17',
          entries: [{ name: '鸡胸肉', grams: 200, calories: 330, proteinGrams: 62, carbohydrateGrams: 0, fatGrams: 0 }],
        }),
      }),
    );
  });
});
