import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'andre.h.costa@yale.edu', name: 'Andre H. Costa', role: 'admin', is_active: 1 };

const PEOPLE = [
  { id: 1, name: 'Jean Bartik', email: 'jean.bartik@a24films.com', title: 'Director of Operations', company: 'A24', person_level: 'working' },
  { id: 2, name: 'Klara Dan', email: 'klara.dan@a24films.com', title: 'Head of Partnerships', company: 'A24', person_level: 'working' },
];

async function mockLanes(page: Page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body: unknown = {};
    if (p === '/api/auth/me') body = { authenticated: true, user };
    else if (p === '/api/contacts') body = { items: PEOPLE, total: PEOPLE.length, limit: 800, offset: 0 };
    else if (p === '/api/campaigns/build') body = { recipients: 2, ready: 2, held: [], sample: { email: 'jean.bartik@a24films.com', subject: 'A24', body: 'Hi Jean.' } };
    else if (p === '/api/yucg/prospects/recommend') body = { recommendations: [], count: 0 };
    else if (p === '/api/contacts/companies/summary') body = [];
    else if (p === '/api/yucgoutreach/runs') body = [];
    else if (p === '/api/yucgoutreach/role-suggestions') body = { company: url.searchParams.get('company'), roles: [], equivalents: [], sources: {} };
    else if (p === '/api/outreach/flows') body = [];
    else if (p === '/api/yucg/prospects') body = { prospects: [], count: 0 };
    else if (p === '/api/yucg/prospects/meta') body = { sectors: [], contact_types: [] };
    else if (p === '/api/yucgoutreach/register/summary') body = { tiers: [], sectors: [], recent_ingests: [] };
    else if (p === '/api/yucgoutreach/register') body = { items: [], total: 0, limit: 40, offset: 0 };
    else if (p === '/api/ai/models') body = { groups: [] };
    else if (p.startsWith('/api/yucg/rosters')) body = { rosters: [] };
    else if (/\/sequences$|\/custom-formats$/.test(p)) body = [];
    await route.fulfill({ json: body });
  });
}

test('the lanes and the sheet stay on screen together at every step', async ({ page }) => {
  await mockLanes(page);
  await page.goto('/scraper?view=company&companies=A24,NEON');

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const rail = pipeline.locator('[data-rail]');
  const lanes = pipeline.getByTestId('company-lanes');
  const picker = pipeline.getByTestId('recipient-picker');

  // Step 2: the people are being chosen, and the flowchart of where each
  // company stands sits above them rather than on another step.
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('data-mode', 'select');
  await expect(lanes).toBeVisible();
  await expect(lanes.getByText('2 companies · 2 people ticked')).toBeVisible();
  await expect(lanes.locator('[data-lane="A24"]').getByTestId('lane-state')).toHaveText('2 found · 2 ticked');
  // The company nobody has been found at says so, rather than looking done.
  await expect(lanes.locator('[data-lane="NEON"]').getByTestId('lane-state')).toHaveText('nobody yet');

  // Step 1: same lanes, and the sheet previews what the companies come with.
  await rail.getByRole('button', { name: /Choose companies/ }).click();
  await expect(lanes).toBeVisible();
  await expect(picker).toHaveAttribute('data-mode', 'preview');
  await expect(picker.getByRole('checkbox', { name: 'Write to Jean Bartik' })).toBeDisabled();

  // Step 3: lanes, then the preview, then the recipients - nothing else.
  await rail.getByRole('button', { name: /^Find people at these 2 companies/ }).click();
  await rail.getByRole('button', { name: /^Write to these 2/ }).click();
  await expect(lanes).toBeVisible();
  await expect(pipeline.getByRole('heading', { name: 'What they will read' })).toBeVisible();
  await expect(picker).toHaveAttribute('data-mode', 'review');
  await expect(picker.getByRole('checkbox')).toHaveCount(0);
});

test('past six companies the lanes fold behind a count so the sheet stays reachable', async ({ page }) => {
  await mockLanes(page);
  const many = Array.from({ length: 20 }, (_, i) => `Company ${i + 1}`);
  await page.goto(`/scraper?view=company&companies=${encodeURIComponent(many.join(','))}`);

  const pipeline = page.locator('[data-section="campaign-pipeline"]');
  const lanes = pipeline.getByTestId('company-lanes');
  await expect(lanes.getByText('20 companies · 0 people ticked')).toBeVisible();
  await expect(lanes.locator('[data-lane]')).toHaveCount(6);
  await expect(lanes.locator('[data-lane="Company 6"]')).toBeVisible();
  await expect(lanes.locator('[data-lane="Company 7"]')).toHaveCount(0);

  const box = await lanes.boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(340);

  await lanes.getByRole('button', { name: '14 more' }).click();
  await expect(lanes.locator('[data-lane]')).toHaveCount(20);
  await lanes.getByRole('button', { name: 'Show fewer' }).click();
  await expect(lanes.locator('[data-lane]')).toHaveCount(6);
});
