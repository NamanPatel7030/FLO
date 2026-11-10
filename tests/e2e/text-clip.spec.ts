import { expect, test, type Page } from "@playwright/test";

// Gradient text (background-clip: text) only paints inside its element's box, so glyph ink that hangs
// outside it (the swash of an italic serif "J" or "f", a "g"/"y" descender, the slant of the last letter)
// gets cut off. styles.css gives every gradient class padding plus an equal negative margin; this test
// measures each glyph's real ink with canvas measureText and checks the painted box covers it.

type Cut = { text: string; cls: string; left: number; right: number; top: number; bottom: number };

async function clippedGradientText(page: Page): Promise<Cut[]> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const out: Cut[] = [];
    const ctx = document.createElement("canvas").getContext("2d")!;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const cs = getComputedStyle(el);
      if (!/text/.test(cs.backgroundClip) && !/text/.test((cs as any).webkitBackgroundClip ?? "")) continue;
      const text = (el.textContent ?? "").trim();
      if (!text || !el.getBoundingClientRect().width) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (!rects.length) continue;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const first = ctx.measureText(text[0]);
      const last = ctx.measureText(text[text.length - 1]);
      const all = ctx.measureText(text);
      const L = rects[0];
      const R = rects[rects.length - 1];
      const asc = all.fontBoundingBoxAscent;
      const desc = all.fontBoundingBoxDescent;
      const ink = {
        left: L.left - first.actualBoundingBoxLeft,
        right: R.right - last.width + last.actualBoundingBoxRight,
        top: L.top + (L.height - (asc + desc)) / 2 + asc - all.actualBoundingBoxAscent,
        bottom: R.top + (R.height - (asc + desc)) / 2 + asc + all.actualBoundingBoxDescent,
      };
      // an inline box paints its background over each line fragment plus its padding
      const box = el.getBoundingClientRect();
      const inline = cs.display === "inline";
      const paint = inline
        ? {
            left: L.left - parseFloat(cs.paddingLeft),
            right: R.right + parseFloat(cs.paddingRight),
            top: Math.min(...rects.map((r) => r.top)) - parseFloat(cs.paddingTop),
            bottom: Math.max(...rects.map((r) => r.bottom)) + parseFloat(cs.paddingBottom),
          }
        : box;
      const cut = {
        left: paint.left - ink.left,
        right: ink.right - paint.right,
        top: paint.top - ink.top,
        bottom: ink.bottom - paint.bottom,
      };
      if (Object.values(cut).some((v) => v > 1))
        out.push({ text: text.slice(0, 40), cls: String(el.className).slice(0, 60), ...cut });
    }
    return out;
  });
}

for (const name of ["Jake", "Jagadeeshwaran", "fig", "gary"]) {
  test(`home greeting: the italic gradient name "${name}" is not clipped`, async ({ page }) => {
    await page.goto(`/?name=${name}#/home`);
    const accent = page.locator("h1 .ink-grad").first();
    await expect(accent).toHaveText(`${name}.`, { timeout: 15_000 }); // first load compiles the dashboard chunk
    expect(await clippedGradientText(page)).toEqual([]);
    // the padding is cancelled by the margin: the name starts right after "Good …, "
    const shift = await accent.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return Math.abs(el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft) - r.getBoundingClientRect().left);
    });
    expect(shift).toBeLessThan(1);
  });
}

test("gradient accents across the dashboard are not clipped", async ({ page }) => {
  for (const p of ["agent", "assistant", "skills", "todos", "projects", "notes", "analytics", "history", "settings/general", "settings/about"]) {
    await page.goto(`/#/${p}`);
    await expect(page.locator("h1:visible").first()).toBeVisible();
    await page.waitForTimeout(600); // the page cross-fade
    expect(await clippedGradientText(page), p).toEqual([]);
  }
});

test("onboarding: the gradient 'Flo' words are not clipped", async ({ page }) => {
  await page.goto("/?onboard=1#/home");
  await expect(page.locator(".onb-grad-text").first()).toBeVisible();
  await page.waitForTimeout(900); // words blur in one by one
  expect(await clippedGradientText(page)).toEqual([]);
});
