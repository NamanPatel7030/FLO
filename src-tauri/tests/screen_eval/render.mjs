// Renders the assistant screen-eval scenes (scenes below) to fixtures:
//   png/<id>.png  — what the window looks like (attached as the screenshot in live runs)
//   ax/<id>.txt   — the window's text, one element per line, table rows joined with " | "
//                   (the shape Flo's accessibility reader produces on macOS)
// Run from the repo root:  node src-tauri/tests/screen_eval/render.mjs
// The eval itself (assistant::screen_eval) reads scenes.json + ax/*.txt; see README.md.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'png'), { recursive: true });
mkdirSync(join(here, 'ax'), { recursive: true });

const css = `
body{font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0;color:#1d1d1f;background:#fff}
.app{display:flex;min-height:100vh}.side{width:210px;background:#f5f5f7;padding:16px;border-right:1px solid #ddd}
.side a{display:block;padding:6px 0;color:#333;text-decoration:none}.main{flex:1;padding:24px 32px}
h1{font-size:22px;margin:0 0 16px}h2{font-size:16px;margin:20px 0 8px}.card{border:1px solid #ddd;border-radius:10px;padding:16px;margin:12px 0}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:8px;text-align:left}
.btn{display:inline-block;padding:8px 14px;border-radius:8px;background:#635bff;color:#fff;margin-right:8px}
.btn.secondary{background:#e8e8ed;color:#111}.muted{color:#777}.err{color:#b00020}.code{font:12px Menlo,monospace;white-space:pre;background:#1e1e1e;color:#ddd;padding:12px}
.msg{padding:6px 0}.who{font-weight:600}.time{color:#888;font-size:12px;margin-left:6px}
`;

const nav = (items) => `<nav class="side">${items.map((i) => `<a href="#">${i}</a>`).join('')}</nav>`;
const filler = (n, label) => Array.from({ length: n }, (_, i) => `<p class="muted">${label} ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>`).join('');

const logLines = () => {
  const out = [];
  for (let i = 0; i < 420; i++) {
    const t = `2026-11-23T10:${String(Math.floor(i / 7)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}Z`;
    if (i === 377) out.push(`${t} ERROR payments.webhook: Stripe webhook failed: signature mismatch for event evt_1QxZ (endpoint /hooks/stripe)`);
    else out.push(`${t} INFO  http: GET /api/v1/items?page=${i} 200 ${12 + (i % 40)}ms user=u_${1000 + i}`);
  }
  return out.join('\n');
};

const scenes = [
  {
    id: 'elevenlabs_subscription', app: 'Google Chrome', title: 'Subscription | ElevenLabs', url: 'https://elevenlabs.io/app/subscription',
    html: `<div class="app">${nav(['Home', 'Voices', 'Text to Speech', 'Voice Changer', 'Sound Effects', 'Dubbing', 'Projects', 'Speech to Text', 'Agents', 'Developers', 'Subscription', 'Usage', 'Payouts', 'Settings'])}
    <main class="main"><h1>Subscription</h1>
    <div class="card"><h2>Current plan</h2><p>Free</p><p class="muted">Your credits reset on December 21, 2026</p>
    <h2>Credits used</h2><p>0 credits / 10,000 credits</p><a class="btn">Upgrade</a><a class="btn secondary">Manage billing</a></div>
    <div class="card"><h2>Usage this period</h2><table><tr><th>Product</th><th>Credits</th></tr><tr><td>Text to Speech</td><td>0</td></tr><tr><td>Voice Changer</td><td>0</td></tr><tr><td>Sound Effects</td><td>0</td></tr></table></div>
    <div class="card"><h2>Plans</h2><table><tr><th>Plan</th><th>Price</th><th>Credits / month</th></tr><tr><td>Starter</td><td>$5/mo</td><td>30,000</td></tr><tr><td>Creator</td><td>$22/mo</td><td>100,000</td></tr><tr><td>Pro</td><td>$99/mo</td><td>500,000</td></tr></table></div>
    </main></div>`,
  },
  {
    id: 'pricing_table', app: 'Safari', title: 'Pricing - Linework', url: 'https://linework.app/pricing',
    html: `<main class="main"><h1>Simple pricing for every team</h1><p class="muted">Billed monthly. Save 20% with annual billing.</p>
    <table><tr><th></th><th>Starter</th><th>Pro</th><th>Team</th></tr>
    <tr><td>Price</td><td>$9 / month</td><td>$29 / month</td><td>$79 / month</td></tr>
    <tr><td>Seats</td><td>1</td><td>5</td><td>25</td></tr>
    <tr><td>Storage</td><td>10 GB</td><td>100 GB</td><td>1 TB</td></tr>
    <tr><td>SSO (SAML)</td><td>No</td><td>No</td><td>Yes</td></tr>
    <tr><td>Priority support</td><td>No</td><td>Yes</td><td>Yes</td></tr></table>
    <a class="btn">Start free trial</a><h2>FAQ</h2>${filler(25, 'Question')}</main>`,
  },
  {
    id: 'vscode_error', app: 'Code', title: 'UserList.tsx — web-app', url: '',
    html: `<div class="app">${nav(['EXPLORER', 'src', 'components', 'UserList.tsx', 'UserCard.tsx', 'api.ts', 'App.tsx', 'package.json'])}
    <main class="main"><div class="code">39  export function UserList({ users }: Props) {
40    const sorted = useSorted(users);
41    return (
42      &lt;ul&gt;{sorted.items.map((u) =&gt; &lt;UserCard key={u.id} user={u} /&gt;)}&lt;/ul&gt;
43    );
44  }</div>
    <h2>TERMINAL</h2><div class="code err">Uncaught TypeError: Cannot read properties of undefined (reading 'map')
    at UserList (src/components/UserList.tsx:42:27)
    at renderWithHooks (react-dom.development.js:16305:18)
    at mountIndeterminateComponent (react-dom.development.js:20074:13)</div>
    <p class="muted">Ln 42, Col 27  Spaces: 2  UTF-8  TypeScript React</p></main></div>`,
  },
  {
    id: 'gmail_thread', app: 'Google Chrome', title: 'Invoice INV-2291 for November - priya@acme.co - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQX',
    html: `<div class="app">${nav(['Compose', 'Inbox 214', 'Starred', 'Snoozed', 'Sent', 'Drafts 3', 'Labels', 'Clients', 'Receipts'])}
    <main class="main"><h1>Invoice INV-2291 for November</h1>
    <div class="card"><span class="who">Daniel Wright</span><span class="time">Nov 18, 9:12 AM</span><p>Hi Priya, could you send over the November invoice when you get a chance? Thanks, Daniel</p></div>
    <div class="card"><span class="who">Priya Shah</span><span class="time">Nov 19, 4:40 PM</span><p>Hi Daniel, attached is invoice INV-2291 for $4,250.00. Payment is due on December 15, 2026. Bank details are on page 2. Best, Priya</p><p class="muted">INV-2291.pdf</p></div>
    <a class="btn secondary">Reply</a><a class="btn secondary">Forward</a></main></div>`,
  },
  {
    id: 'slack_channel', app: 'Slack', title: 'launch (Channel) - Northwind - Slack', url: '',
    html: `<div class="app">${nav(['Northwind', 'Threads', 'Huddles', 'Channels', '# general', '# launch', '# design', 'Direct messages', 'Meera Iyer', 'Rahul Verma'])}
    <main class="main"><h1># launch</h1>
    <div class="msg"><span class="who">Meera Iyer</span><span class="time">9:02 AM</span><p>Landing page copy is final. Screenshots by noon?</p></div>
    <div class="msg"><span class="who">Arjun Rao</span><span class="time">9:15 AM</span><p>On it. Also the press embargo lifts Thursday 8 AM PT.</p></div>
    <div class="msg"><span class="who">Rahul Verma</span><span class="time">9:41 AM</span><p>Moving standup to 10:30 today, the design review ran over. Please bring the launch checklist.</p></div>
    <p class="muted">Message #launch</p></main></div>`,
  },
  {
    id: 'jira_ticket', app: 'Google Chrome', title: '[FLO-482] Export fails for large workspaces - Jira', url: 'https://northwind.atlassian.net/browse/FLO-482',
    html: `<div class="app">${nav(['Your work', 'Projects', 'Filters', 'Dashboards', 'Teams', 'Flo board', 'Backlog', 'Releases'])}
    <main class="main"><p class="muted">Projects / Flo / FLO-482</p><h1>Export fails for large workspaces</h1>
    <h2>Description</h2><p>Exporting a workspace with more than 5,000 notes times out after 30 seconds and the download never starts.</p>
    <h2>Details</h2><table><tr><td>Status</td><td>In Progress</td></tr><tr><td>Assignee</td><td>Ananya Kulkarni</td></tr><tr><td>Reporter</td><td>Daniel Wright</td></tr>
    <tr><td>Priority</td><td>High</td></tr><tr><td>Due date</td><td>Dec 5, 2026</td></tr><tr><td>Sprint</td><td>Sprint 42</td></tr><tr><td>Story points</td><td>5</td></tr>
    <tr><td>Linked issues</td><td>is blocked by FLO-479 (Streaming zip writer)</td></tr></table>
    <h2>Activity</h2>${filler(12, 'Comment')}</main></div>`,
  },
  {
    id: 'revenue_dashboard', app: 'Google Chrome', title: 'Dashboard - Payments', url: 'https://dashboard.payments.example/dashboard',
    html: `<div class="app">${nav(['Home', 'Balances', 'Transactions', 'Customers', 'Product catalog', 'Billing', 'Reports', 'Connect', 'Developers'])}
    <main class="main"><h1>Today</h1>
    <div class="card"><h2>Gross volume</h2><p>$12,480.20</p><p class="muted">Yesterday $10,902.11</p></div>
    <div class="card"><h2>MRR</h2><p>$48,920</p><p class="muted">+6.4% vs last month</p></div>
    <div class="card"><h2>Churn rate</h2><p>2.1%</p></div>
    <div class="card"><h2>New customers (this month)</h2><p>134</p></div>
    <div class="card"><h2>Failed payments</h2><p>7</p></div>
    <div class="card"><h2>USD balance</h2><p>$31,207.44</p><p class="muted">Next payout Nov 25</p></div></main></div>`,
  },
  {
    id: 'invoice_paid', app: 'Google Chrome', title: 'Invoice #1042 - Harbor Studio', url: 'https://billing.harborstudio.example/invoices/1042',
    html: `<main class="main"><h1>Invoice #1042</h1><p><b>Status:</b> Paid</p><p class="muted">Paid on Nov 12, 2026 by Visa ending 4242</p>
    <table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr><tr><td>Brand workshop</td><td>1</td><td>$900.00</td></tr><tr><td>Logo revisions</td><td>3</td><td>$270.00</td></tr><tr><td>Tax (9.75%)</td><td></td><td>$114.50</td></tr>
    <tr><td><b>Total</b></td><td></td><td><b>$1,284.50</b></td></tr></table><a class="btn secondary">Download PDF</a></main>`,
  },
  {
    id: 'code_editor', app: 'Cursor', title: 'pricing.py — shop', url: '',
    html: `<main class="main"><div class="code">1  DEFAULT_DISCOUNT = 0.15
2  MAX_DISCOUNT = 0.4
3
4  def calculate_discount(total, code=None):
5      """Return the discount amount for an order total."""
6      rate = DEFAULT_DISCOUNT
7      if code == "VIP":
8          rate = 0.25
9      return round(total * min(rate, MAX_DISCOUNT), 2)</div><p class="muted">Ln 4, Col 5  Python 3.12</p></main>`,
  },
  {
    id: 'signup_form', app: 'Google Chrome', title: 'Create your account - Orbit', url: 'https://orbit.example/signup',
    html: `<main class="main"><h1>Create your account</h1>
    <p><label>Full name <input value="Parth G"></label></p><p><label>Work email * <input value=""></label></p>
    <p><label>Company <input value="Flo Labs"></label></p><p><label>Password * <input type="password" value="secret"></label></p>
    <p><label>Plan <select><option>Starter</option><option selected>Pro</option></select></label></p>
    <p class="muted">* required</p><a class="btn">Create account</a></main>`,
  },
  {
    id: 'server_logs', app: 'Google Chrome', title: 'Logs - api-prod - Render', url: 'https://dashboard.render.example/web/api-prod/logs',
    html: `<main class="main"><h1>api-prod logs</h1><div class="code">${logLines()}</div></main>`,
  },
  {
    id: 'design_canvas', app: 'Figma', title: 'Onboarding v3 - Figma', url: '',
    // a canvas app: accessibility exposes almost nothing, OCR reads the pixels
    html: `<main class="main" style="background:#2c2c2c;color:#eee;min-height:100vh"><p>Frame: Desktop / Welcome  1440 × 1024</p>
    <div style="background:#fff;color:#111;padding:40px;margin:20px;border-radius:12px"><h1>Welcome to Orbit</h1><p>Plan launches, not spreadsheets.</p>
    <a class="btn" style="background:#16a34a">Get started</a></div></main>`,
    ax: 'Figma\nOnboarding v3\n',
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const index = [];
for (const s of scenes) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${s.html}</body></html>`);
  await page.screenshot({ path: join(here, 'png', `${s.id}.png`) });
  // element text in document order, table rows on one line (like the accessibility reader)
  const ax = s.ax ?? (await page.evaluate(() => {
    const out = [];
    const walk = (el) => {
      if (el.tagName === 'TR') { out.push([...el.children].map((c) => c.innerText.trim()).filter(Boolean).join(' | ')); return; }
      if (el.tagName === 'INPUT') { if (el.type !== 'password') out.push(el.value); return; }
      if (el.tagName === 'SELECT') { out.push(el.options[el.selectedIndex].text); return; }
      const inline = [...el.children].every((c) => ['B', 'I', 'EM', 'STRONG', 'CODE'].includes(c.tagName));
      if (inline) { out.push(...el.innerText.split('\n').map((l) => l.trim()).filter(Boolean)); return; }
      for (const n of el.childNodes) {
        if (n.nodeType === 3) out.push(...n.textContent.split('\n').map((l) => l.trim()).filter(Boolean));
        else if (n.nodeType === 1) walk(n);
      }
    };
    walk(document.body);
    return out.join('\n') + '\n';
  }));
  writeFileSync(join(here, 'ax', `${s.id}.txt`), ax);
  // what OCR would read: the visible pixels only (the viewport's text)
  const ocr = await page.evaluate(() => document.body.innerText.split('\n').slice(0, 60).join('\n'));
  writeFileSync(join(here, 'ax', `${s.id}.ocr.txt`), ocr + '\n');
  index.push({ id: s.id, app: s.app, title: s.title, url: s.url });
}
writeFileSync(join(here, 'screens.json'), JSON.stringify(index, null, 2) + '\n');
await browser.close();
console.log(`rendered ${scenes.length} scenes`);
