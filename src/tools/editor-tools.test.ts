import { describe, expect, it } from "vitest";
import { registerEditorTools } from "./editor-tools.js";

describe("editor tools", () => {
  it("accepts an empty runtime wait request so the runtime bridge can default to one frame", () => {
    const tools = new Map();
    registerEditorTools(tools as any, {
      projectPath: "/test/project",
      editorConnected: false,
      editorPort: 6550,
    });

    const runtimeWaitTool = tools.get("godot_runtime_wait");
    expect(runtimeWaitTool).toBeDefined();
    expect(runtimeWaitTool?.inputSchema.parse({})).toEqual({});
  });

  describe("godot_runtime_click schema is introspectable", () => {
    // The MCP SDK's normalizeObjectSchema (zod-compat.js) checks for `.shape`
    // on the inputSchema to decide whether to convert it to JSON Schema for
    // tools/list. ZodEffects (the return of `.refine()`) does not expose
    // `.shape` directly, so wrapping the object in `.refine()` causes the
    // tool to be exposed over the wire with empty `properties: {}` — losing
    // x/y/button/holdFrames as discoverable parameters. Keeping the schema
    // a bare ZodObject (and moving cross-field validation into the handler)
    // preserves discoverability.

    const setup = () => {
      const tools = new Map();
      registerEditorTools(tools as any, {
        projectPath: "/test/project",
        editorConnected: false,
        editorPort: 6550,
      });
      return tools.get("godot_runtime_click")!;
    };

    it("exposes a `.shape` so the MCP SDK can convert it to JSON Schema", () => {
      const tool = setup();
      expect(tool.inputSchema.shape).toBeDefined();
      expect(Object.keys(tool.inputSchema.shape ?? {})).toEqual(
        expect.arrayContaining(["x", "y", "button", "holdFrames"])
      );
    });

    it("accepts both x and y together", () => {
      const tool = setup();
      expect(() => tool.inputSchema.parse({ x: 100, y: 200 })).not.toThrow();
    });

    it("accepts neither x nor y (state-based click)", () => {
      const tool = setup();
      expect(() => tool.inputSchema.parse({})).not.toThrow();
    });

    it("rejects only-x or only-y at handler time with a clear message", async () => {
      const tool = setup();
      await expect(tool.handler({ x: 100 })).rejects.toThrow(/both x and y|x and y together/i);
      await expect(tool.handler({ y: 200 })).rejects.toThrow(/both x and y|x and y together/i);
    });
  });
});
