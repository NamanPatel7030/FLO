import { expect, test, type Page } from "@playwright/test";

// Windows / Linux behaviour, driven through the mock backend's ?platform= override (the browser
// preview is macOS by default). The real WebKitGTK / WebView2 checks are listed in the report.

const calls = (page: Page) => page.evaluate(() => ((window as any).__floMock.calls as { cmd: string; args: any }[]).map((c) => c.cmd));

async function openPill(page: Page, query: string) {
  await page.goto(`/?${query}#/island`);
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.getByTestId("island-pill").waitFor();
  await page.waitForTimeout(150);
}

/** Every outer (non-inset) shadow's reach past the box: [up, right, down, left] in px. */
function shadowReach(css: string): number[] {
  const reach = [0, 0, 0, 0];
  for (const part of css.split(/,(?![^(]*\))/)) {
    if (/inset/.test(part) || part.trim() === "none") continue;
    const n = (part.replace(/rgba?\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
    const [x = 0, y = 0, blur = 0, spread = 0] = n;
    const r = blur + spread;
    reach[0] = Math.max(reach[0], r - y);
    reach[1] = Math.max(reach[1], r + x);
    reach[2] = Math.max(reach[2], r + y);
    reach[3] = Math.max(reach[3], r - x);
  }
  return reach;
}

for (const platform of ["linux", "windows"] as const) {
  test(`${platform}: the pill drags anywhere, and the click that ends a drag is swallowed`, async ({ page }) => {
    await openPill(page, `platform=${platform}`);
    // press on a tray item (a button): dragging from it must not trigger it
    const b = (await page.getByTestId("island-pill").locator("button").first().boundingBox())!;
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 1); // under the threshold: still a click
    expect(await calls(page)).not.toContain("island_drag_start");
    await page.mouse.move(x + 40, y + 30, { steps: 6 });
    await page.mouse.move(x + 120, y + 200, { steps: 6 });
    await page.mouse.up();
    // a plain click right after (before the hover panel opens under the resting cursor) still works
    const n = (await calls(page)).length;
    await page.mouse.click(x, y);
    await expect.poll(() => calls(page)).toContain("island_drag_end");
    // what a click on the pill opens: the dashboard, or a tray item (a Claude session, the to-dos)
    const OPENS = ["open_dashboard", "open_claude_by_session"];
    const all = await calls(page);
    const seq = all.slice(0, n).filter((c) => c.startsWith("island_drag") || OPENS.includes(c));
    expect(seq[0]).toBe("island_drag_start");
    expect(seq).toContain("island_drag_move");
    expect(seq.at(-1)).toBe("island_drag_end");
    // a drag never opens anything on release
    expect(seq.filter((c) => OPENS.includes(c))).toEqual([]);
    // the click after it did, and didn't start another drag
    await expect.poll(async () => (await calls(page)).slice(n).filter((c) => OPENS.includes(c)).length).toBe(1);
    expect((await calls(page)).slice(n)).not.toContain("island_drag_start");
  });

  test(`${platform}: the pill's shadow ends inside its window (no dark box around it)`, async ({ page }) => {
    await openPill(page, `platform=${platform}`);
    const pill = page.getByTestId("island-pill");
    const root = page.locator("[data-island-root]");
    const [pb, rb] = [(await pill.boundingBox())!, (await root.boundingBox())!];
    // room between the pill and the window edge on each side
    const room = [pb.y - rb.y, rb.x + rb.width - (pb.x + pb.width), rb.y + rb.height - (pb.y + pb.height), pb.x - rb.x];
    const reach = shadowReach(await pill.evaluate((el) => getComputedStyle(el).boxShadow));
    reach.forEach((r, i) => expect(r, `side ${i}`).toBeLessThanOrEqual(room[i] + 0.5));
  });
}

test("linux without a compositor: the pill is a solid tile filling its window", async ({ page }) => {
  await openPill(page, "platform=linux&opaque=1");
  const pill = page.getByTestId("island-pill");
  const root = page.locator("[data-island-root]");
  await expect.poll(async () => Math.round((await pill.boundingBox())!.width)).toBe(Math.round((await root.boundingBox())!.width));
  expect(await pill.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("0px");
  expect(await root.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(5, 8, 13)");
});

test("macOS: the notch never drags", async ({ page }) => {
  await openPill(page, "nh=38&nw=200");
  const b = (await page.getByTestId("island-pill").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await calls(page)).not.toContain("island_drag_start");
});

test("linux / windows: the dashboard canvas is solid in dark mode; macOS keeps its vibrancy tint", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("flo:theme-mode", "dark"));
  const bodyBg = async (platform: string) => {
    await page.goto(`/?platform=${platform}#/home`);
    await page.waitForFunction(() => !!(window as any).__floMock);
    // the in-app window (html.tauri); the preview can't add it by itself
    await page.evaluate(() => document.documentElement.classList.add("tauri"));
    return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  };
  expect(await bodyBg("linux")).toBe("rgb(2, 4, 8)");
  await expect(page.locator("html")).toHaveClass(/platform-linux/);
  expect(await bodyBg("windows")).toBe("rgb(2, 4, 8)");
  expect(await bodyBg("macos")).toMatch(/0\.86\)$/);
});

test("linux: no backdrop blur (slow in WebKitGTK); macOS keeps it", async ({ page }) => {
  const blur = async (platform: string) => {
    await page.goto(`/?platform=${platform}#/home`);
    await page.locator(".glass-strong").first().waitFor();
    return page.locator(".glass-strong").first().evaluate((el) => getComputedStyle(el).backdropFilter || (getComputedStyle(el) as any).webkitBackdropFilter);
  };
  expect(await blur("linux")).toBe("none");
  expect(await blur("macos")).not.toBe("none");
});

for (const theme of ["light", "dark"] as const) {
  test(`skill canvas text is readable in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("flo:theme-mode", t), theme);
    await page.goto("/#/skills");
    await page.waitForFunction(() => !!(window as any).__floMock);
    await page.getByRole("button", { name: /Slack reply/ }).click();
    const name = page.getByTestId("skill-editor").getByLabel("Skill name");
    await expect(name).toHaveValue("Slack reply");
    // the canvas is always dark: its text must be light (relative luminance well above the bg)
    const lum = await name.evaluate((el) => {
      const [r, g, b] = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number);
      const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    });
    expect(lum).toBeGreaterThan(0.6);
  });
}

test("linux: Permissions lists what Flo needs there, with fixes and what isn't needed", async ({ page }) => {
  await page.goto("/?platform=linux#/settings/permissions");
  const list = page.getByTestId("platform-checks");
  await expect(list).toBeVisible();
  // the things that matter on Linux, not just the microphone
  for (const id of ["microphone", "keyboard", "typing", "screen", "ocr", "accessibility", "autostart"]) await expect(list.getByTestId(`check-${id}`)).toBeVisible();
  // missing + required first, with the exact command to copy
  await expect(list.locator("[data-testid^=check-]").first()).toHaveAttribute("data-testid", "check-keyboard");
  await expect(list.getByTestId("check-keyboard")).toContainText("sudo usermod -aG input $USER");
  await expect(list.getByRole("button", { name: "Copy sudo usermod -aG input $USER" })).toBeVisible();
  // and a one-line reason when something isn't needed on this OS
  await expect(list.getByTestId("check-accessibility")).toContainText("Not needed");
  await expect(list.getByTestId("check-accessibility")).toHaveAttribute("data-status", "notNeeded");
  // Fix turns on start at login, and the status follows
  await list.getByTestId("check-autostart").getByRole("button", { name: "Turn on" }).click();
  await expect(list.getByTestId("check-autostart")).toHaveAttribute("data-status", "ok", { timeout: 6000 });
  // the macOS-only repair box isn't offered here
  await expect(page.getByRole("button", { name: /Repair permissions/ })).toHaveCount(0);
});

test("windows: Permissions says Screen and Accessibility aren't needed", async ({ page }) => {
  await page.goto("/?platform=windows#/settings/permissions");
  const list = page.getByTestId("platform-checks");
  await expect(list.getByTestId("check-screen")).toHaveAttribute("data-status", "notNeeded");
  await expect(list.getByTestId("check-accessibility")).toContainText("Not needed on Windows");
  await expect(list.getByTestId("check-keyboard")).toHaveAttribute("data-status", "ok");
});

test("macOS: Permissions keeps the real system grants", async ({ page }) => {
  await page.goto("/#/settings/permissions");
  await expect(page.getByText("Accessibility").first()).toBeVisible();
  await expect(page.getByTestId("platform-checks")).toHaveCount(0);
});

test("linux: copy says computer, never Mac", async ({ page }) => {
  await page.goto("/?platform=linux#/settings/appearance");
  await expect(page.getByText(/The pill stays dark/)).toBeVisible();
  await page.goto("/?platform=linux#/skills");
  await expect(page.getByText(/Do skills operate your computer/)).toBeVisible();
  await expect(page.getByText(/your Mac/)).toHaveCount(0);
});

// ── Windows / Linux: the pill and its window always agree (no clipped / offset panels) ──────────
type Box = { x: number; y: number; width: number; height: number };
const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

async function hoverPill(page: Page) {
  const b = (await page.getByTestId("island-pill").boundingBox())!;
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await page.mouse.move(b.x + 8, b.y + b.height / 2);
}

for (const platform of ["linux", "windows"] as const) {
  test(`${platform}: the open panel fills its window, resizes once each way, and leaves nothing behind`, async ({ page }) => {
    await openPill(page, `platform=${platform}`);
    const resizes = () => page.evaluate(() => ((window as any).__floMock.resizes as unknown[]).length);
    const r0 = await resizes();
    await hoverPill(page);
    const tile = page.getByText("Stopwatch", { exact: true });
    await expect(tile).toBeVisible();
    await page.waitForTimeout(300);
    const [pill, root] = [(await page.getByTestId("island-pill").boundingBox())!, (await page.locator("[data-island-root]").boundingBox())!];
    // the pill is the window minus the 12 px shadow margin on every side
    expect(Math.abs(pill.x - root.x - 12)).toBeLessThan(1);
    expect(Math.abs(root.x + root.width - (pill.x + pill.width) - 12)).toBeLessThan(1);
    expect(Math.abs(root.y + root.height - (pill.y + pill.height) - 12)).toBeLessThan(1);
    // every widget is drawn whole inside the pill (the clock and the Today tile were cut off)
    for (const t of ["Stopwatch", "Clock"]) expect(inside((await page.getByText(t, { exact: true }).boundingBox())!, pill), t).toBe(true);
    // one resize to open: no grow-to-union then shrink
    expect((await resizes()) - r0).toBe(1);

    // leave: back to the capsule right away, window and pill together, one more resize
    await page.mouse.move(5, 600);
    await expect(tile).toHaveCount(0);
    await expect.poll(async () => Math.round((await page.locator("[data-island-root]").boundingBox())!.height)).toBeLessThan(80);
    const [p2, r2] = [(await page.getByTestId("island-pill").boundingBox())!, (await page.locator("[data-island-root]").boundingBox())!];
    expect(Math.round(r2.width - p2.width)).toBe(24);
    expect(Math.round(r2.height - p2.height)).toBe(24);
    expect((await resizes()) - r0).toBe(2);
  });

  test(`${platform}: a hovered tray item's list opens inside the card, under the row`, async ({ page }) => {
    await openPill(page, `platform=${platform}`);
    // the second tray item is the to-dos (the first is the stack of agent sessions)
    await page.getByTestId("island-pill").locator("button").nth(1).hover();
    const tip = page.locator(".island-tip");
    await expect(tip).toBeVisible();
    await page.waitForTimeout(300);
    const [t, pill] = [(await tip.boundingBox())!, (await page.getByTestId("island-pill").boundingBox())!];
    expect(inside(t, pill)).toBe(true);
    // a card, not a giant capsule
    expect(await page.getByTestId("island-pill").evaluate((el) => getComputedStyle(el).borderRadius)).toBe("22px");
  });
}

test("the stopwatch keeps counting when the island closes", async ({ page }) => {
  await openPill(page, "platform=linux");
  await hoverPill(page);
  await page.locator("button", { hasText: /^Start$/ }).click();
  await page.mouse.move(5, 600);
  await expect(page.getByText("Stopwatch", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(2300);
  await hoverPill(page);
  await expect(page.locator("button", { hasText: /^Pause$/ })).toBeVisible();
  const label = await page.getByText(/^\d\d:\d\d$/).first().textContent();
  expect(Number(label!.slice(3))).toBeGreaterThanOrEqual(2);
});

// ── idle cost: nothing keeps drawing while Flo just sits there ─────────────────────────────────
/** Count animation frames and running CSS animations over one second. */
async function idleActivity(page: Page) {
  return page.evaluate(async () => {
    let frames = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      frames++;
      return orig(cb);
    };
    await new Promise((r) => setTimeout(r, 1000));
    window.requestAnimationFrame = orig;
    const running = document.getAnimations().filter((a) => a.playState === "running").length;
    return { frames, running };
  });
}

for (const platform of ["linux", "windows"] as const) {
  test(`${platform}: the collapsed pill is completely still`, async ({ page }) => {
    await openPill(page, `platform=${platform}`);
    await page.mouse.move(5, 600);
    await page.waitForTimeout(800);
    expect(await idleActivity(page)).toEqual({ frames: 0, running: 0 });
  });

  test(`${platform}: a dashboard in the background pauses its animations`, async ({ page }) => {
    await page.goto(`/?platform=${platform}#/home`);
    await page.waitForFunction(() => !!(window as any).__floMock);
    await page.getByTestId("ocean-backdrop").first().waitFor({ state: "attached" });
    // another app comes to the front
    await page.evaluate(() => {
      Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true });
      window.dispatchEvent(new Event("blur"));
    });
    await expect(page.locator("html")).toHaveClass(/unfocused/);
    await page.waitForTimeout(200);
    expect((await idleActivity(page)).running).toBe(0);
    // and resumes when it's back
    await page.evaluate(() => {
      Object.defineProperty(document, "hasFocus", { value: () => true, configurable: true });
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.locator("html")).not.toHaveClass(/unfocused/);
  });
}

test("macOS: the dashboard keeps animating in the background (unchanged)", async ({ page }) => {
  await page.goto("/#/home");
  await page.waitForFunction(() => !!(window as any).__floMock);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true });
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(200);
  expect((await idleActivity(page)).running).toBeGreaterThan(0);
});
