import { describe, expect, it } from "vitest";
import { ipToInt, planVlsm, subnetLayout } from "./subnet";
import { blockColors, describeScope, describeSubnet, detectIpClass, escapeHtml, freeColor, subnetCells, vlsmCells, vlsmColors } from "./view";

describe("IP class detection", () => {
  it("should detect classes A to E", () => {
    expect(detectIpClass("12.14.1.1")).toBe("A");
    expect(detectIpClass("172.16.0.1")).toBe("B");
    expect(detectIpClass("192.168.1.1")).toBe("C");
    expect(detectIpClass("224.0.0.1")).toBe("D");
    expect(detectIpClass("240.0.0.1")).toBe("E");
  });

  it("should mark 0.x and 127.x as reserved", () => {
    expect(detectIpClass("0.0.0.0")).toBe("Reserved");
    expect(detectIpClass("127.0.0.1")).toBe("Reserved");
  });

  it("should return 'Invalid IP' outside the classes", () => {
    expect(detectIpClass("300.1.1.1")).toBe("Invalid IP");
  });
});

describe("Subnet description", () => {
  it("should list the subnet's addresses", () => {
    expect(describeSubnet(ipToInt("192.168.1.70"), 26).split("\n")).toEqual([
      "Address    192.168.1.70/26",
      "Netmask    255.255.255.192",
      "Wildcard   0.0.0.63",
      "Network    192.168.1.64",
      "Broadcast  192.168.1.127",
      "Hosts      192.168.1.65 - 192.168.1.126 (62)",
      "Scope      Private (RFC 1918) 192.168.0.0/16",
    ]);
  });

  it("should call addresses outside special blocks public", () => {
    expect(describeScope(ipToInt("8.8.8.8"))).toBe("Public");
    expect(describeScope(ipToInt("127.0.0.1"))).toBe("Loopback 127.0.0.0/8");
  });
});

describe("HTML escaping", () => {
  it("should escape markup characters", () => {
    expect(escapeHtml(`<b a="1">&'`)).toBe("&#60;b a=&#34;1&#34;&#62;&#38;&#39;");
  });
});

describe("Subnet cells", () => {
  const ip = ipToInt("192.168.1.70");
  const cells = subnetCells(ip, 26, subnetLayout(ip, 26, 24));

  it("should draw one cell per address of a class C network", () => {
    expect(cells).toHaveLength(256);
  });

  it("should mark the IP, its subnet and the other subnets", () => {
    expect(cells[70]).toMatchObject({ group: 1, color: blockColors.ip, height: 3.5 });
    expect(cells[70].label).toBe("192.168.1.70\nin 192.168.1.64/26\n(your IP)");
    expect(cells[65]).toMatchObject({ group: 1, color: blockColors.subnet, height: 2 });
    expect(cells[1]).toMatchObject({ group: 0, color: blockColors.others[0], height: 1 });
    expect(cells[129]).toMatchObject({ group: 2, color: blockColors.others[2], height: 1 });
  });

  it("should mark network and broadcast addresses", () => {
    expect(cells[64]).toMatchObject({ color: blockColors.reserved, height: 0.4 });
    expect(cells[64].label).toContain("(network address)");
    expect(cells[127].label).toContain("(broadcast address)");
  });

  it("should not reserve the ends of /31 subnets", () => {
    const ip31 = ipToInt("192.168.1.4");
    const cells31 = subnetCells(ip31, 31, subnetLayout(ip31, 31, 24));
    expect(cells31[0].color).toBe(blockColors.others[0]);
  });
});

describe("VLSM cells", () => {
  const plan = planVlsm(ipToInt("192.168.1.0"), 24, [{ name: "A", hosts: 50 }, { name: "B", hosts: 2 }]);
  const cells = vlsmCells(plan.blocks);

  it("should draw one cell per address", () => {
    expect(cells).toHaveLength(256);
  });

  it("should split each subnet into needed and spare hosts", () => {
    expect(cells[1]).toMatchObject({ group: 0, color: vlsmColors[0], height: 1.6, label: "192.168.1.1\nA 192.168.1.0/26" });
    expect(cells[50]).toMatchObject({ height: 1.6 });
    expect(cells[51]).toMatchObject({ height: 0.6 });
    expect(cells[51].label).toContain("(spare)");
    expect(cells[65]).toMatchObject({ group: 1, color: vlsmColors[1], height: 1.6 });
  });

  it("should mark network and broadcast addresses", () => {
    expect(cells[0]).toMatchObject({ color: blockColors.reserved, height: 0.4 });
    expect(cells[63].label).toContain("(broadcast address)");
    expect(cells[64].label).toContain("(network address)");
  });

  it("should draw free space flat", () => {
    expect(cells[68]).toMatchObject({ group: 2, color: freeColor, height: 0.15, label: "192.168.1.68\nfree 192.168.1.68/30" });
    expect(cells[255].group).toBe(plan.blocks.length - 1);
  });

  it("should share cells between addresses in a large network", () => {
    const big = planVlsm(ipToInt("10.0.0.0"), 16, [{ name: "A", hosts: 1000 }]);
    const bigCells = vlsmCells(big.blocks);
    expect(bigCells).toHaveLength(1024);
    expect(bigCells[0].label).toBe("10.0.0.0 - 10.0.0.63\nA 10.0.0.0/22");
  });
});
