import { describe, expect, it } from 'vitest'
import { convertNutrientUnit, normalizeBarcode, normalizeSearchText } from './normalize'

describe('food catalog normalization', () => {
  it('normalizes German accents and transliterations to the same search key', () => {
    expect(normalizeSearchText('Hähnchenbrust')).toBe('hahnchenbrust')
    expect(normalizeSearchText('Haehnchenbrust')).toBe('hahnchenbrust')
  })

  it('normalizes valid product codes to GTIN-14 and rejects invalid checksums', () => {
    expect(normalizeBarcode('4006381333931')).toBe('04006381333931')
    expect(normalizeBarcode('4006381333932')).toBeNull()
    expect(normalizeBarcode('not-a-barcode')).toBeNull()
  })

  it('converts only explicit compatible nutrient units', () => {
    expect(convertNutrientUnit(1, 'g', 'mg')).toBe(1000)
    expect(convertNutrientUnit(1000, 'µg', 'mg')).toBe(1)
    expect(() => convertNutrientUnit(1, 'IU', 'mg')).toThrow('Unbekannte Nährstoffeinheit')
  })
})
