import { describe, it, expect } from 'vitest';
import { posFontStyle } from '../../utils/posTypography.js';

describe('POS typography utility', () => {
  it('applies custom posFontSize and posFontFamily to style object', () => {
    const result = posFontStyle({ posFontSize: 20, posFontFamily: 'Arial' });
    expect(result.fontSize).toBe('20px');
    expect(result.fontFamily).toBe('Arial');
  });

  it('defaults to 14px and no fontFamily when settings are empty', () => {
    const result = posFontStyle({});
    expect(result.fontSize).toBe('14px');
    expect(result.fontFamily).toBeUndefined();
  });

  it('applies posFontFamily "Courier New" when set in settings', () => {
    const result = posFontStyle({ posFontSize: 14, posFontFamily: 'Courier New' });
    expect(result.fontSize).toBe('14px');
    expect(result.fontFamily).toBe('Courier New');
  });
});
