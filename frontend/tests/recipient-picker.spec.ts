import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'andre.h.costa@yale.edu', name: 'Andre H. Costa', role: 'admin', is_active: 1 };

const FOUND = [
  { id: 1, name: 'Jean Bartik', email: 'jean.bartik@a24films.com', title: 'Director of Operations', company: 'A24', person_level: 'working' },
  { id: 2, name: 'Klara Dan', email: 'klara.dan@a24films.com', title: 'VP Partnerships', company: 'A24', person_level: 'working' },
  { id: 3, name: 'Ada Lovelace', email: 'ada@a24films.com', title: 'Trustee', company: 'A24', person_level: 'board' },
  { id: 4, name: 'Alan Turing', email: 'alan@a24films.com', title: 'Chief Executive Officer', company: 'A24', person_level: 'executive', last_sent_at: '2026-09-02 10:00:00', last_campaign_name: 'Spring intro' },
  { id: 5, name: 'Grace Hopper', email: '', title: 'Head of Insight', company: 'A24', person_level: 'working' },
];

/** What the NEON search finds: two people, one of whom the import refuses. */
const PROSPECTS = [
  { id: 91, run_id: 9, first_name: 'Margaret', last_name: 'Hamilton', email: 'margaret@neon.com', title: 'Head of Partnerships', score: 90 },
  { id: 92, run_id: 9, first_name: 'Dorothy', last_name: 'Vaughan', email: 'dorothy@neon.com', title: 'Programme Lead', score: 80 },
];

const AFTER_ADD = {
  id: 6, name: 'Margaret Hamilton', email: 'margaret@neon.com', title: 'Head of Partnerships',
  company: 'NEON', person_level: 'working',
};

async function mockPicker(page: Page, opts: { busy?: boolean } = {}) {
  const built: Record<string, unknown>[] = [];
  const drafted: Record<string, unknown>[] = [];
  const runsCreated: Record<string, unknown>[] = [];
  const imported: unknown[] = [];
  let runPolls = 0;
  let added = false;
  let attempted = false;

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    let body: unknown = {};
    let status = 200;
    if (p === '/api/auth/me') body = { authenticated: true, user };
    else if (p === '/api/contacts') {
      const items = added ? [...FOUND, AFTER_ADD] : FOUND;
      body = { items, total: items.length, limit: 800, offset: 0 };
    } else if (p === '/api/yucgoutreach/runs' && method === 'POST') {
      runsCreated.push(route.request().postDataJSON());
      if (opts.busy) {
        // The server's one-search-per-member rule, met by a search this
        // page did not know about until it asked.
        attempted = true;
        status = 409;
        body = { detail: 'You already have a company search queued or running' };
      } else {
        body = { id: 9, status: 'queued' };
      }
    } else if (p === '/api/yucgoutreach/runs' && method === 'GET') {
      body = opts.busy && attempted
        ? [{ id: 8, company_name: 'Acme Corp', status: 'running', progress_pct: 30, progress_message: 'Website and web search…' }]
        : [];
    } else if (p === '/api/yucgoutreach/runs/9') {
      runPolls += 1;
      body = runPolls === 1
        ? { id: 9, company_name: 'NEON', status: 'running', progress_pct: 40, progress_message: 'Website and web search…' }
        : { id: 9, company_name: 'NEON', status: 'completed', progress_pct: 100, progress_message: 'Done — 2 verified prospects saved' };
    } else if (p === '/api/yucgoutreach/runs/9/prospects') {
      body = PROSPECTS;
    } else if (p === '/api/yucgoutreach/runs/9/import-contacts') {
      const payload = route.request().postDataJSON();
      imported.push(payload);
      const ids: number[] = payload.prospect_ids;
      added = ids.includes(91);
      body = {
        created: ids.includes(91) ? 1 : 0, updated: 0, skipped: ids.includes(92) ? 1 : 0,
        results: ids.map((id) => (id === 91
          ? { prospect_id: 91, contact_id: 6, outcome: 'created' }
          : { prospect_id: 92, contact_id: null, outcome: 'skipped', reason: 'already worked by Alice' })),
      };
    } else if (p === '/api/campaigns/draft-template') {
      const payload = route.request().postDataJSON();
      drafted.push(payload);
      body = payload.per_company
        ? { messages: Object.fromEntries((payload.companies || []).map((c: string) => [
            c, { subject: `${c} and Yale`, body: `Hi {first}, about {company}.` }])), grounded: payload.companies }
        : { subject: 'One subject', body: 'Hi {first}.' };
    } else if (p === '/api/campaigns/build') {
      const payload = route.request().postDataJSON();
      if (!payload.preview_only) built.push(payload);
      body = payload.preview_only
        ? { recipients: (payload.contact_ids || []).length, ready: (payload.contact_ids || []).length, held: [], sample: null }
        : { campaign_id: 42, created: (payload.contact_ids || []).length, name: 'A24', held: [] };
    }
    else if (p === '/api/contacts/companies/summary') body = [];
    else if (p === '/api/outreach/flows') body = [];
    else if (p === '/api/yucgoutreach/register/summary') body = { tiers: [], sectors: [], recent_ingests: [] };
    else if (p === '/api/yucgoutreach/register') body = { items: [], total: 0, limit: 40, offset: 0 };
    else if (p === '/api/yucgoutreach/role-suggestions') body = { company: url.searchParams.get('company'), roles: [], equivalents: [], sources: {} };
    else if (p === '/api/ai/models') body = { groups: [] };
    else if (p.startsWith('/api/yucg/rosters')) body = { rosters: [] };
    else if (/\/sequences$|\/custom-formats$/.test(p)) body = [];
    await route.fulfill({ status, json: body });
  });
  return { built, drafted, runsCreated, imported };
}

test('the campaign is written to the people who were ticked, not to everyone found', async ({ page }) => {
  const { built } = await mockPicker(page);
  await page.goto('/scraper?view=company&companies=A24');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');
  const picker = pipeline.getByTestId('recipient-picker');
  await expect(picker).toBeVisible();

  // Four people have an address. The two who work there are ticked; the board
  // seat and the person already written to are not, because writing to either
  // is a decision, not a default.
  await expect(pipeline.getByTestId('selected-count')).toHaveText('2 of 4 selected');
  await expect(picker.getByRole('checkbox', { name: 'Write to Jean Bartik' })).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'Write to Ada Lovelace' })).not.toBeChecked();

  // Someone with no address cannot be ticked at all, rather than being ticked
  // and failing at send time.
  await expect(picker.getByRole('checkbox', { name: 'Write to Grace Hopper' })).toBeDisabled();

  // Untick one, add the board seat deliberately.
  await picker.getByRole('checkbox', { name: 'Write to Klara Dan' }).uncheck();
  await picker.getByRole('checkbox', { name: 'Write to Ada Lovelace' }).check();
  await expect(pipeline.getByTestId('selected-count')).toHaveText('2 of 4 selected');

  await rail.getByRole('button', { name: /^Write to these 2/ }).click();
  // From here the sheet is the recipients and nothing else: no ticks, no
  // filters, and nobody who was not chosen.
  await expect(picker).toHaveAttribute('data-mode', 'review');
  await expect(pipeline.getByTestId('selected-count')).toHaveText('2 recipients');
  await expect(picker.getByText('Klara Dan')).toHaveCount(0);
  await expect(picker.getByRole('checkbox')).toHaveCount(0);

  await rail.getByLabel('Subject').fill('A24 and Yale');
  await rail.getByLabel('Message').fill('Hi {first}, about {company}.');
  await rail.getByRole('button', { name: 'Preview the real message' }).click();
  await pipeline.getByRole('button', { name: 'Looks right' }).click();
  await rail.getByRole('button', { name: /^Build the campaign/ }).click();

  await expect.poll(() => built.length).toBe(1);
  // Exactly the ticks, and nothing the member turned off.
  expect(built[0].contact_ids).toEqual([1, 3]);
});

test('a company with nobody on file is searched from its lane, and its people are added one by one', async ({ page }) => {
  const { runsCreated, imported } = await mockPicker(page);
  await page.goto('/scraper?view=company&companies=A24,NEON');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');
  const picker = pipeline.getByTestId('recipient-picker');
  const neon = picker.locator('[data-company="NEON"]');
  const neonLane = pipeline.locator('[data-lane="NEON"]');
  // Wait for the people already on file, so the row states are settled.
  await expect(picker.getByText('Jean Bartik')).toBeVisible();

  // The titles the member typed reach the search as typed.
  await rail.getByLabel('Titles to prioritise').fill('Head of Partnerships');

  // Searching used to mean a second panel with its own company field. The
  // company that needs people carries the button that finds them, on its lane.
  await neonLane.hover();
  await neonLane.getByRole('button', { name: 'Find people' }).click();
  await expect(neonLane).toHaveAttribute('data-state', 'searching');

  await expect.poll(() => runsCreated.length).toBe(1);
  expect(runsCreated[0].company_name).toBe('NEON');
  expect(runsCreated[0].title_hints).toBe('Head of Partnerships');
  expect(runsCreated[0].max_prospects).toBe(60);

  // Found is not on file. The people the search turned up sit under NEON,
  // marked as found, and nothing is imported until somebody is added.
  await expect(neonLane).toHaveAttribute('data-state', 'done', { timeout: 15000 });
  await expect(neon.getByText('2 found · not on file yet')).toBeVisible();
  await expect(neonLane.getByTestId('lane-state')).toHaveText('2 found');
  expect(imported).toHaveLength(0);

  // Clear, then add one person: the selection is exactly that person. A
  // refresh must not re-tick everyone the member just cleared.
  await picker.getByRole('button', { name: /^Clear$/ }).click();
  await expect(pipeline.getByTestId('selected-count')).toHaveText('0 of 4 selected');
  await neon.getByRole('button', { name: 'Add Margaret Hamilton' }).click();

  await expect.poll(() => imported.length).toBe(1);
  expect(imported[0]).toEqual({ prospect_ids: [91] });
  await expect(picker.getByRole('checkbox', { name: 'Write to Margaret Hamilton' })).toBeChecked();
  await expect(pipeline.getByTestId('selected-count')).toHaveText('1 of 5 selected');
  // Added, so no longer "found"; Dorothy is still there to be added.
  await expect(neon.locator('[data-found="91"]')).toHaveCount(0);
  await expect(neon.getByRole('button', { name: 'Add Dorothy Vaughan' })).toBeVisible();
  await expect(neonLane.getByTestId('lane-state')).toHaveText('2 found · 1 ticked');

  // A person the server refuses stays listed with the reason, and cannot be
  // added again.
  await neon.getByRole('button', { name: 'Add Dorothy Vaughan' }).click();
  await expect(neon.getByText('not added: already worked by Alice')).toBeVisible();
  await expect(neon.getByRole('button', { name: 'Add Dorothy Vaughan' })).toHaveCount(0);
});

test('a second search while one is running waits its turn, and a 409 is never shown as an error', async ({ page }) => {
  await mockPicker(page, { busy: true });
  await page.goto('/scraper?view=company&companies=NEON');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const neonLane = pipeline.locator('[data-lane="NEON"]');
  await neonLane.hover();
  await neonLane.getByRole('button', { name: 'Find people' }).click();

  await expect(neonLane).toHaveAttribute('data-state', 'queued');
  await expect(pipeline.getByRole('status').filter({ hasText: 'Already searching Acme Corp' })).toBeVisible();
  await expect(pipeline.getByRole('alert')).toHaveCount(0);
});

test('seniority narrows who is shown and who select-all reaches', async ({ page }) => {
  await mockPicker(page);
  await page.goto('/scraper?view=company&companies=A24');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  await pipeline.getByLabel('Seniority').selectOption('board');
  await pipeline.getByLabel(/Hide the \d+ already written to/).uncheck();

  // The filter is what "select all shown" means, so a member cannot widen the
  // send by accident while looking at a narrowed list.
  await expect(pipeline.getByText('Ada Lovelace')).toBeVisible();
  await expect(pipeline.getByText('Jean Bartik')).toHaveCount(0);
  await pipeline.getByRole('button', { name: /^Clear$/ }).click();
  await pipeline.getByRole('button', { name: /^Select all shown/ }).click();
  await expect(pipeline.getByTestId('selected-count')).toHaveText('1 of 4 selected');
});


test('one message per company, written from what the club knows about it', async ({ page }) => {
  const { built, drafted } = await mockPicker(page);
  await page.goto('/scraper?view=company&companies=A24,NEON');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');
  await rail.getByRole('button', { name: /^Write to these/ }).click();

  // Several companies is usually several things to say, so saying them is one
  // checkbox rather than four campaigns.
  await rail.getByLabel(/Write a different message for each company/).check();
  await rail.getByLabel('Email goal').fill('Offer a free ops review this term');
  await rail.getByRole('button', { name: /^Draft a message for each of these 2 companies/ }).click();

  await expect.poll(() => drafted.length).toBe(1);
  expect(drafted[0].per_company).toBe(true);
  expect(drafted[0].companies).toEqual(['A24', 'NEON']);

  // What the model wrote is editable per company, not something to accept.
  const messages = rail.getByTestId('per-company-messages');
  await expect(messages).toBeVisible();
  await rail.getByLabel('Subject for NEON').fill('NEON, from Yale');

  await rail.getByRole('button', { name: 'Preview the real message' }).click();
  await pipeline.getByRole('button', { name: 'Looks right' }).click();
  await rail.getByRole('button', { name: /^Build the campaign/ }).click();

  await expect.poll(() => built.length).toBe(1);
  // Each company's message travels with the campaign, so the send path writes
  // that company's people from that company's text.
  const sent = built[0].messages as Record<string, { subject: string }>;
  expect(sent.A24.subject).toBe('A24 and Yale');
  expect(sent.NEON.subject).toBe('NEON, from Yale');
});
