import { safeJsonLd } from '../json-ld';

describe('safeJsonLd', () => {
  test('serializes simple objects', () => {
    const obj = { name: 'Test', value: 123 };
    const result = safeJsonLd(obj);
    expect(result).toBe('{"name":"Test","value":123}');
  });

  test('escapes < characters to \\u003c', () => {
    const obj = { text: '<script>' };
    const result = safeJsonLd(obj);
    expect(result).toContain('\\u003cscript\\u003e');
    expect(result).not.toContain('<script>');
  });

  test('escapes > characters to \\u003e', () => {
    const obj = { text: 'test>' };
    const result = safeJsonLd(obj);
    expect(result).toContain('\\u003e');
    expect(result).not.toContain('>');
  });

  test('escapes & characters to \\u0026', () => {
    const obj = { text: 'a & b' };
    const result = safeJsonLd(obj);
    expect(result).toContain('\\u0026');
    expect(result).not.toContain('&');
  });

  test('prevents XSS via closing script tag', () => {
    const obj = { title: 'Test</script><img src=x onerror=alert(1)>' };
    const result = safeJsonLd(obj);
    // Verify escaped characters are in result
    expect(result).toContain('\\u003c');
    // Verify no unescaped dangerous characters
    expect(result).not.toContain('</script>');
  });

  test('handles arrays', () => {
    const obj = [1, 2, { text: '<test>' }];
    const result = safeJsonLd(obj);
    expect(result).toContain('\\u003ctest\\u003e');
  });

  test('handles nested objects', () => {
    const obj = {
      name: 'Test',
      data: {
        description: 'A <b>bold</b> description & more',
      },
    };
    const result = safeJsonLd(obj);
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u003e');
    expect(result).toContain('\\u0026');
  });

  test('handles null', () => {
    expect(safeJsonLd(null)).toBe('null');
  });

  test('handles strings directly', () => {
    const result = safeJsonLd('simple string');
    expect(result).toBe('"simple string"');
  });

  test('handles numbers', () => {
    expect(safeJsonLd(42)).toBe('42');
    expect(safeJsonLd(3.14)).toBe('3.14');
  });

  test('handles booleans', () => {
    expect(safeJsonLd(true)).toBe('true');
    expect(safeJsonLd(false)).toBe('false');
  });

  test('result is valid JSON', () => {
    const obj = { name: 'Test', data: [1, 2, { nested: true }] };
    const result = safeJsonLd(obj);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test('parsed result matches original data', () => {
    const obj = { name: 'Test', value: 123, nested: { item: 'value' } };
    const result = safeJsonLd(obj);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(obj);
  });

  test('multiple escape sequences in one string', () => {
    const obj = { html: '<div>&nbsp;</div>' };
    const result = safeJsonLd(obj);
    const parsed = JSON.parse(result);
    expect(parsed.html).toBe('<div>&nbsp;</div>');
    // Original should be escaped in serialized form
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u003e');
    expect(result).toContain('\\u0026');
  });

  test('escapes all three characters together', () => {
    const obj = { dangerous: '<&>' };
    const result = safeJsonLd(obj);
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u0026');
    expect(result).toContain('\\u003e');
  });
});
