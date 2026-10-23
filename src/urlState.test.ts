import { describe, expect, it } from "vitest";
import { decodeState, encodeState } from "./urlState";
import type { PageState } from "./urlState";

const defaults: PageState = { ip: "", parent: null, mode: "equal", net: "", requests: [{ name: "LAN A", hosts: 50 }], allow31: false };

describe("URL state", () => {
  it("should leave a fresh page out of the hash", () => {
    expect(encodeState(defaults)).toBe("");
  });

  it("should round-trip the equal-subnets view", () => {
    const state = { ...defaults, ip: "10.20.30.40/24", parent: 16 };
    expect(decodeState(`#${encodeState(state)}`, defaults)).toEqual(state);
  });

  it("should round-trip VLSM requests, including names with colons and commas", () => {
    const state: PageState = { ...defaults, mode: "vlsm", net: "10.0.0.0/16", requests: [{ name: "Site: A, north", hosts: 500 }, { name: "Link", hosts: 2 }], allow31: true };
    expect(decodeState(encodeState(state), defaults)).toEqual(state);
  });

  it("should only keep VLSM settings in VLSM mode", () => {
    expect(encodeState({ ...defaults, net: "10.0.0.0/8", allow31: true })).toBe("");
  });

  it("should fall back to the defaults for missing or malformed values", () => {
    expect(decodeState("#parent=abc&mode=other&s=nohosts&s=x:1.5", defaults)).toEqual({ ...defaults, requests: [] });
    expect(decodeState("", defaults)).toEqual(defaults);
    expect(decodeState("#parent=200", defaults).parent).toBeNull();
  });
});
