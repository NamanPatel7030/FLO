// The floating pill on Windows / Linux, with the real pointer: hover opens the panel and the window
// grows to exactly the panel's size (nothing clipped), widgets work (stopwatch), dragging moves it,
// the spot is remembered across a restart, and moving away closes it again.
import { assert, invoke, markOnboarded, os, ready, screen, shot, signInQuick, sleep, toIsland, toMain, waitFor, win } from "../support/app.mjs";

async function domSize() {
  return browser.execute(() => {
    const root = document.querySelector("[data-island-root]");
    const pill = document.querySelector("[data-testid=island-pill]");
    const r = root?.getBoundingClientRect();
    const p = pill?.getBoundingClientRect();
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      root: r && { x: r.x, y: r.y, w: r.width, h: r.height },
      pill: p && { x: p.x, y: p.y, w: p.width, h: p.height, right: p.right, bottom: p.bottom },
      panel: !!document.querySelector("[data-testid=notch-panel]"),
    };
  });
}

const centre = (w) => [w.x + w.width / 2, w.y + w.height / 2];

/** the island's window must be exactly its content: nothing clipped, nothing extra */
async function assertFits(tag) {
  const w = await win("island");
  const d = await domSize();
  const tol = 2;
  assert.ok(Math.abs(d.innerW - w.width) <= tol && Math.abs(d.innerH - w.height) <= tol, `${tag}: the web view fills the window (${d.innerW}x${d.innerH} vs ${w.width}x${w.height})`);
  assert.ok(d.pill, `${tag}: the pill is drawn`);
  assert.ok(d.pill.x >= -tol && d.pill.y >= -tol && d.pill.right <= d.innerW + tol && d.pill.bottom <= d.innerH + tol, `${tag}: the pill fits inside the window (pill ${JSON.stringify(d.pill)} in ${d.innerW}x${d.innerH})`);
  if (d.root) assert.ok(Math.abs(d.root.w - w.width) <= tol && Math.abs(d.root.h - w.height) <= tol, `${tag}: the window is the content's size (content ${d.root.w}x${d.root.h}, window ${w.width}x${w.height})`);
  return { w, d };
}

describe("the pill", () => {
  let rest;

  before(async () => {
    await ready();
    await signInQuick();
    await markOnboarded();
    os.move(5, 700); // pointer well away from the pill
    await sleep(1500);
  });

  it("rests as a small pill at the top centre, fully on screen", async () => {
    rest = await win("island");
    assert.ok(rest.visible, "visible");
    assert.ok(rest.width < 400 && rest.height < 120, `small at rest (${rest.width}x${rest.height})`);
    await toIsland();
    await assertFits("rest");
    await shot("rest");
    screen("rest");
  });

  it("hover opens the panel and the window grows to fit it exactly", async () => {
    const [cx, cy] = centre(rest);
    os.move(cx - 10, cy);
    await sleep(150);
    os.move(cx, cy);
    const open = await waitFor(
      async () => {
        const w = await win("island");
        return w.height > rest.height + 40 ? w : null;
      },
      { timeout: 8000, msg: "the pill to open on hover" },
    );
    await sleep(900); // let the open animation settle
    await toIsland();
    await waitFor(async () => (await domSize()).panel, { timeout: 5000, msg: "the panel (quick actions + widgets)" });
    await sleep(400);
    // it must STAY open while the pointer rests on it (no open/close flapping)
    const heights = [];
    for (let i = 0; i < 8; i++) {
      heights.push((await win("island")).height);
      await sleep(150);
    }
    assert.ok(heights.every((h) => h > rest.height + 40), `stays open under a resting pointer (heights ${heights.join(",")})`);
    await assertFits("open");
    await shot("open");
    screen("open");
    assert.ok(open.width >= rest.width, "wider when open");
  });

  it("stopwatch widget counts while the panel is open", async () => {
    const start = await $("//button[normalize-space(.)='Start']");
    await start.waitForExist({ timeout: 5000 });
    await start.click();
    await sleep(2300);
    const t = await browser.execute(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((x) => /^\d\d:\d\d$/.test(x ?? "")));
    assert.ok(t && t !== "00:00", `stopwatch is counting (${t})`);
    await $("//button[normalize-space(.)='Pause']").click();
    await shot("stopwatch");
  });

  it("moving away closes it back to the pill", async () => {
    os.move(5, 700);
    await waitFor(async () => (await win("island")).height <= rest.height + 2, { timeout: 8000, msg: "the pill to close" });
    await sleep(600);
    await assertFits("closed");
  });

  it("drags to a new spot and snaps there", async () => {
    const before = await win("island");
    // grab it like a person does: point at the pill, let the hover panel open, then press inside
    // the panel's top padding (not on one of its buttons, and not on the window's outermost
    // pixels, which Linux treats as a resize border) and pull
    os.move(...centre(before));
    await sleep(1200);
    const grab = await win("island");
    const cx = grab.x + grab.width / 2;
    const cy = grab.y + 18;
    os.move(cx, cy);
    await sleep(200);
    os.down();
    const path_ = [];
    for (let i = 1; i <= 12; i++) {
      os.move(cx - 20 * i, cy + 25 * i);
      await sleep(60);
      const w = await win("island");
      path_.push(`${Math.round(w.x)},${Math.round(w.y)}`);
    }
    os.up();
    console.log("drag path:", path_.join(" "));
    await sleep(800);
    os.move(5, 5);
    await sleep(800);
    // ask from the dashboard: it shows whether the app (not just the pill's web view) responds
    await toMain();
    const after = await win("island");
    assert.ok(Math.abs(after.x - before.x) > 100 && after.y - before.y > 150, `moved (${before.x},${before.y}) → (${after.x},${after.y})`);
    rest = after;
    await toIsland();
    await assertFits("dragged");
    screen("dragged");
  });

  it("remembers the spot after a restart", async () => {
    const spot = await win("island");
    await browser.reloadSession(); // quits Flo and starts it again (same app data)
    await ready();
    await waitFor(async () => (await win("island"))?.visible, { timeout: 20000, msg: "the pill after restart" });
    await sleep(1500);
    const again = await win("island");
    assert.ok(Math.abs(again.x - spot.x) <= 12 && Math.abs(again.y - spot.y) <= 12, `same spot after restart (${spot.x},${spot.y}) vs (${again.x},${again.y})`);
    screen("after-restart");
    await toMain();
    assert.equal((await invoke("account_status")).signedIn, true, "still signed in after restart");
  });
});
