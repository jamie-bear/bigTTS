import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStaticFilePath } from "../../src/server.js";

describe("static file containment", () => {
  const root = path.resolve("dist");

  it("accepts a normal hashed asset under dist", () => {
    const resolved = resolveStaticFilePath("/assets/app.1234.js", root);
    expect(resolved.contained).toBe(true);
    expect(resolved.absolutePath).toBe(path.join(root, "assets", "app.1234.js"));
  });

  it("rejects encoded traversal into a sibling sharing the dist prefix", () => {
    const resolved = resolveStaticFilePath("/%2e%2e/dist-archive/app.js", root);
    expect(resolved.contained).toBe(false);
  });

  it("rejects malformed percent encoding as a client path error", () => {
    expect(() => resolveStaticFilePath("/assets/bad%2.js", root)).toThrow(URIError);
  });
});
