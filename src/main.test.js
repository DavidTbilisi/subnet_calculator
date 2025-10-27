const main = require("../dist/main");

describe("IP Class Detection", () => {
  it("should return class A for IP", () => {
    const ip = "12.14.1.1";
    const result = main.detectIpClass(ip);
    expect(result).toBe("A");
  });
});


describe("IP Class Detection", () => {
  it("should return class B for IP", () => {
    const ip = "172.16.0.1";
    const result = main.detectIpClass(ip);
    expect(result).toBe("B");
  });
});

describe("IP Class Detection", () => {
  it("should return class C for IP", () => {
    const ip = "192.168.1.1";
    const result = main.detectIpClass(ip);
    expect(result).toBe("C");
  });
});

describe("IP Class Detection", () => {
  it("should return class D for IP", () => {
    const ip = "224.0.0.1";
    const result = main.detectIpClass(ip);
    expect(result).toBe("D");
  });
});

describe("IP Class Detection", () => {
  it("should return class E for IP", () => {
    const ip = "240.0.0.1";
    const result = main.detectIpClass(ip);
    expect(result).toBe("E");
  });
});

describe("IP Class Detection", () => {
  it("should return 'Invalid IP' for invalid IP", () => {
    const ip = "300.1.1.1";
    const result = main.detectIpClass(ip);
    expect(result).toBe("Invalid IP");
  });
});
