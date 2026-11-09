import { expect, test } from "@playwright/test";

// "connect to Mobbin MCP" said to Flo: the Apps page opens the Add MCP server form, filled in.
test("voice: connect to a misheard MCP name pre-fills the Add MCP server form", async ({ page }) => {
  await page.goto("/?signedin=1#/agent/apps");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await expect(page.getByTestId("agent-apps")).toBeVisible();
  const r = await page.evaluate(() => (window as any).__floMock.invoke("ask_assistant", { text: "connect to Mobin MCP" }));
  expect((r as any).actions[0]).toMatchObject({ type: "connect_mcp", name: "Mobbin" });
  const name = page.locator('input[value="Mobbin"]');
  await expect(name).toBeVisible();
});
