import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'andre.h.costa@yale.edu', name: 'Andre H. Costa', role: 'admin', is_active: 1 };

const PEOPLE = [
  { id: 1, name: 'Jean Bartik', email: 'jean.bartik@a24films.com', title: 'Head of Acquisitions', company: 'A24' },
  { id: 2, name: 'Klara Dan', email: 'klara.dan@a24films.com', title: 'VP Partnerships', company: 'A24' },
  // No name, so a message using {first} cannot be rendered for them.
  { id: 3, name: '', email: 'info@a24films.com', title: '', company: 'A24' },
];

async function mockPipeline(page: Page) {
  const built: Record<string, unknown>[] = [];
  const sequences: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body: unknown = {};
    if (p === '/api/auth/me') body = { authenticated: true, user };
    else if (p === '/api/contacts') body = { items: PEOPLE, total: PEOPLE.length, limit: 400, offset: 0 };
    else if (p === '/api/campaigns/build') {
      const payload = route.request().postDataJSON();
      // The server renders; the mock mirrors its contract so the spec covers
      // the wiring rather than re-implementing the renderer.
      const named = PEOPLE.filter(c => c.name && payload.contact_ids?.includes(c.id));
      const unnamed = PEOPLE.filter(c => !c.name && payload.contact_ids?.includes(c.id));
      if (payload.preview_only) {
        body = {
          recipients: (payload.contact_ids || []).length,
          ready: named.length,
          held: unnamed.map(c => ({ contact_id: c.id, email: c.email, reason: `${c.email} has no first on record, and the message uses it.` })),
          sample: named[0]
            ? { email: named[0].email, subject: `A24 and Yale`, body: `Hi ${named[0].name.split(' ')[0]}, about A24.` }
            : null,
        };
      } else {
        built.push(payload);
        body = { campaign_id: 42, created: named.length, name: 'A24', held: [] };
      }
    }
    else if (p === '/api/outreach/sequences' && route.request().method() === 'POST') {
      sequences.push(route.request().postDataJSON());
      body = { id: 7, ok: true };
    }
    else if (p === '/api/contacts/companies/summary') body = [];
    else if (p === '/api/contacts/email-patterns') body = { domain: '', count: 0, patterns: [] };
    else if (p === '/api/yucgoutreach/runs') body = [];
    else if (p === '/api/outreach/flows') body = [];
    else if (p === '/api/yucgoutreach/register/summary') body = { tiers: [], sectors: [], recent_ingests: [] };
    else if (p === '/api/yucgoutreach/register') body = { items: [], total: 0, limit: 40, offset: 0 };
    else if (p === '/api/ai/models') body = { groups: [] };
    else if (p.startsWith('/api/yucg/rosters')) body = { rosters: [] };
    else if (p === '/api/yucgoutreach/domain-guess') {
      const company = url.searchParams.get('company') || '';
      body = company === 'Meta' ? { domain: 'meta.com', verified: true } : { domain: null, verified: false };
    }
    else if (p === '/api/projects/suggest-citations') {
      body = {
        projects: [{ id: 1, client_name: 'Google', description: 'Brand refresh', semester: 'Spring 2026' }],
        team_experience: [{ user_name: 'Aaron Combs', role_in_project: 'Market Analyst', client_name: 'Adidas', semester: 'Fall 2025' }],
      };
    }
    else if (/\/sequences$|\/custom-formats$/.test(p)) body = [];
    await route.fulfill({ json: body });
  });
  return { built, sequences };
}

test('companies to people, then each person handed to Drafts', async ({ page }) => {
  await mockPipeline(page);
  await page.goto('/scraper?view=company');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');

  // 1. Companies are a multiple choice, not one at a time.
  await rail.getByLabel('Company').fill('A24');
  await rail.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(rail.getByText('1 chosen')).toBeVisible();
  await rail.getByRole('button', { name: /^Find people/ }).click();

  // 2. The people found, grouped by company, with the option to drop one.
  await expect(pipeline.getByText('Jean Bartik')).toBeVisible();
  await expect(pipeline.getByText('Klara Dan')).toBeVisible();
  await rail.getByRole('button', { name: /^Write to these/ }).click();

  // 3. No shared template: the exact people ticked go to Drafts, where each
  //    gets an email of their own.
  await expect(rail.getByText(/advisory note on two\s+or three projects/)).toBeVisible();
  await expect(rail.getByLabel('Subject')).toHaveCount(0);
  await rail.getByRole('button', { name: /^Write to these \d+ in Drafts/ }).click();
  await expect(page).toHaveURL(/\/studio\?companies=A24&contact_ids=\d+(%2C\d+)*$/);
});

test('a company that is not on file anywhere can still be worked', async ({ page }) => {
  await mockPipeline(page);
  await page.goto('/scraper?view=company');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');

  // The public register is a starting point, not a fence. A member who knows
  // a company nobody has heard of types the name and works it exactly like
  // any other.
  await rail.getByLabel('Company').fill('Bartik Family Foundation');
  await rail.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(rail.getByRole('button', { name: '✓ Bartik Family Foundation' })).toBeVisible();
  await expect(rail.getByText('1 chosen')).toBeVisible();

  // And it carries into the next step rather than being dropped as unknown.
  await rail.getByRole('button', { name: 'Find people', exact: true }).click();
  await expect(pipeline.locator('[data-lane="Bartik Family Foundation"]')).toBeVisible();
  // With nobody on file the company keeps its group and offers the search
  // that would fill it, rather than silently vanishing from the step.
  await expect(pipeline.getByRole('button', { name: 'Find people here' })).toBeVisible();
});

test('a large company selection stays a count and a screenful, not a wall of chips', async ({ page }) => {
  await mockPipeline(page);
  const many = Array.from({ length: 300 }, (_, i) => `Company ${i + 1}`);
  await page.goto(`/scraper?view=company&companies=${encodeURIComponent(many.join(','))}`);

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');
  await rail.getByRole('button', { name: /Choose companies/ }).click();

  // Every chosen company used to become a DOM node. A selection this size is
  // a count plus the ones being worked on, with the rest one click away.
  await expect(rail.getByText('300 companies chosen')).toBeVisible();
  const chips = rail.getByTestId('company-chips').getByRole('button');
  const collapsed = await chips.count();
  expect(collapsed).toBeLessThanOrEqual(26);
  await rail.getByRole('button', { name: /^\+\d+ more$/ }).click();
  expect(await chips.count()).toBeGreaterThan(collapsed);

  // And the step says the campaign ceiling before the server refuses it.
  await page.goto(`/scraper?view=company&companies=${encodeURIComponent(
    Array.from({ length: 501 }, (_, i) => `Big ${i + 1}`).join(','))}`);
  await rail.getByRole('button', { name: /Choose companies/ }).click();
  await expect(rail.getByText(/at most 500/)).toBeVisible();
});

test('a company with no confirmed domain gets an honest, non-blocking search warning', async ({ page }) => {
  await mockPipeline(page);
  await page.goto('/scraper?view=company&companies=A24');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  await expect(pipeline.getByTestId('domain-guess-warning')).toContainText(
    'No confirmed website found for A24', { timeout: 10_000 },
  );
  // Advisory only: the lane's own search button stays usable.
  const lane = pipeline.locator('[data-lane="A24"]');
  await expect(lane.getByRole('button', { name: /^(\+ )?Find (more )?people$/ })).toBeEnabled();
});

test('a verified domain guess offers a one-click accept that fills the domain field', async ({ page }) => {
  await mockPipeline(page);
  await page.goto('/scraper?view=company&companies=Meta');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');
  await rail.getByText('Search settings').click();
  const suggestion = rail.getByTestId('domain-guess-suggestion');
  await expect(suggestion).toContainText('meta.com', { timeout: 10_000 });
  await suggestion.getByRole('button', { name: 'Use it' }).click();
  await expect(rail.getByLabel('Company domain')).toHaveValue('meta.com');
});
