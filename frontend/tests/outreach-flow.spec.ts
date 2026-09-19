import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'alice@yale.edu', name: 'Alice', role: 'admin', is_active: 1 };

/**
 * Two-click outreach: "Outreach this company" starts a flow; the tracker
 * walks Find people -> Save contacts -> Draft emails -> Review & release and
 * hands off to the campaign. The backend is mocked; the sequence of flow
 * states is what a real flow returns while the scheduler advances it.
 */
async function mockFlow(page: Page) {
  const mutations: { path: string; body: unknown }[] = [];
  const states = [
    { status: 'discovering', progress_pct: 20, progress_message: 'Sources: website 3 · roster 7 · web 25 — merging…' },
    { status: 'importing', progress_pct: 60, progress_message: 'Saving people to your contacts…' },
    { status: 'drafting', progress_pct: 80, progress_message: 'Drafting 6/12…', imported_count: 12, drafted_count: 6 },
    { status: 'ready', progress_pct: 100, progress_message: '12 draft(s) ready for 12 people.', imported_count: 12, drafted_count: 12, campaign_id: 44, campaign_name: 'Acme Corp — Sep 19', campaign_status: 'draft' },
  ];
  let polls = 0;
  const base = { id: 7, company_name: 'Acme Corp', company_domain: 'acme.com', title_hints: 'VPs', max_contacts: 25, run_id: 91 };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') mutations.push({ path, body: request.postDataJSON() });
    let body: unknown = {};
    if (path === '/api/auth/me') body = { authenticated: true, user };
    else if (path === '/api/outreach/flows' && request.method() === 'POST') body = { ...base, ...states[0] };
    else if (path === '/api/outreach/flows') body = [];
    else if (path === '/api/outreach/flows/7') { body = { ...base, ...states[Math.min(polls, states.length - 1)] }; polls += 1; }
    else if (path === '/api/yucgoutreach/runs') body = [];
    else if (path === '/api/yucg/prospects') body = { prospects: [], count: 0 };
    else if (path === '/api/yucg/prospects/meta') body = { sectors: [], contact_types: [] };
    else if (path === '/api/yucgoutreach/role-suggestions') {
      const q = new URL(request.url()).searchParams;
      body = {
        company: q.get('company'),
        roles: [
          { title: 'Member of Technical Staff', count: 9, source: 'run' },
          { title: 'Product Lead', count: 4, source: 'search' },
          { title: 'Chief Operating Officer', count: 1, source: 'roster' },
        ],
        equivalents: q.get('hints')
          ? [
              { asked: 'healthcare PMs', at_company: ['Product Lead'], note: 'No PM title in use; product roles are Product Lead.' },
              { asked: 'VPs', at_company: [], note: 'No VP titles observed.' },
            ]
          : [],
        sources: { run: 1, roster: 1, catalog: 0, search: 1 },
      };
    }
    else if (path === '/api/contacts') body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === '/api/ai/models') body = { groups: [] };
    else if (path === '/api/campaigns/44') body = { id: 44, name: 'Acme Corp — Sep 19', status: 'draft', owner_user_id: 1, sender_user_id: 1, contacts: [], readiness: { ready: true, issues: [] } };
    else if (/\/companies\/summary$|\/sequences$|\/custom-formats$|\/rosters$/.test(path)) body = [];
    else if (path.startsWith('/api/yucg/rosters')) body = { rosters: [] };
    await route.fulfill({ json: body });
  });
  return mutations;
}

test('one click starts the flow and the tracker hands off to Review & release', async ({ page }) => {
  const mutations = await mockFlow(page);
  await page.goto('/scraper');

  await page.getByLabel('Company', { exact: true }).fill('Acme Corp');
  await page.getByLabel('Titles to prioritize').fill('VPs');
  await page.getByTestId('outreach-this-company').click();

  expect(mutations.find((m) => m.path === '/api/outreach/flows')?.body).toMatchObject({
    company_name: 'Acme Corp',
    title_hints: 'VPs',
  });

  const tracker = page.getByTestId('outreach-flow');
  await expect(tracker).toBeVisible();
  await expect(tracker.getByText('Acme Corp')).toBeVisible();
  // While live, the primary action is disabled so a member cannot double-start.
  await expect(page.getByTestId('outreach-this-company')).toBeDisabled();

  // The tracker polls through to ready and offers the second click.
  const review = tracker.getByRole('link', { name: 'Review & release' });
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(tracker.getByText('12 people saved · 12 draft(s) ready. Nothing has been sent.')).toBeVisible();
  await expect(review).toHaveAttribute('href', '/campaigns/44');

  // Nothing in the flow sends or releases: the only non-telemetry mutation was starting it.
  expect(mutations.map((m) => m.path).filter((p) => !p.startsWith('/api/telemetry/'))).toEqual(['/api/outreach/flows']);
  await page.screenshot({ path: 'test-results/outreach-flow-ready.png', fullPage: true });
});

test('role bubbles translate asked roles into the company vocabulary and fill the titles field', async ({ page }) => {
  await mockFlow(page);
  await page.goto('/scraper');

  await page.getByLabel('Company', { exact: true }).fill('OpenAI');
  const bubbles = page.getByTestId('role-suggestions');
  await expect(bubbles.getByText('Roles seen at OpenAI')).toBeVisible({ timeout: 10_000 });
  await expect(bubbles.getByRole('button', { name: /Member of Technical Staff/ })).toBeVisible();

  // Typing hints triggers the equivalence strip.
  await page.getByLabel('Titles to prioritize').fill('healthcare PMs, VPs');
  await expect(bubbles.getByText('No PM title in use; product roles are Product Lead.')).toBeVisible({ timeout: 10_000 });
  await expect(bubbles.getByText('no matching title seen at OpenAI')).toBeVisible();

  // Clicking the company's equivalent appends it to the hints and disables that chip.
  await bubbles.getByRole('button', { name: '+ Product Lead' }).click();
  await expect(page.getByLabel('Titles to prioritize')).toHaveValue('healthcare PMs, VPs, Product Lead');
  await expect(bubbles.getByRole('button', { name: /^Product Lead/ })).toBeDisabled();
  await page.screenshot({ path: 'test-results/role-bubbles.png', fullPage: true });
});
