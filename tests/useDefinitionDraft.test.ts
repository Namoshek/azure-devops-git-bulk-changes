import { act, renderHook } from "@testing-library/react";
import { useDefinitionDraft } from "../src/Hubs/CollectionHub/hooks/useDefinitionDraft";

describe("useDefinitionDraft", () => {
  it("preserves invalid YAML when an operation append cannot be applied", () => {
    const invalidYaml = "name: [unclosed";
    const { result } = renderHook(() => useDefinitionDraft());

    act(() => result.current.setYamlText(invalidYaml));
    act(() => result.current.addOperation("add"));

    expect(result.current.yamlText).toBe(invalidYaml);
    expect(result.current.parsed.ok).toBe(false);
  });
});
