const main = require('../dest/main');

describe('IP Class Detection', () => {
  it('should return class A for IP', () => {
    const ip = '12.14.1.1';
    const result = main.detectIpClass(ip);
    expect(result).toBe('A');
  });
});