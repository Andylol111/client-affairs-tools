import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'alice@yale.edu', name: 'Alice', role: 'admin', is_active: 1 };

const REGISTER_HIT = {
  id: 9,
  source: 'companies_house',
  tier: 'uk',
  country: 'GB',
  company_name: 'Hansford Sensors Limited',
  company_domain: 'hansfordsensors.com',
  sector_label: 'Manufacture of electronic industrial process control equipment',
  region: 'High Wycombe',
  employees: null,
  employees_source: null,
  last_event_at: '2025-12-31',
  last_event_amount: null,
  last_event_kind: 'accounts_filed',
  officer_count: 3,
  metadata: {},
};

async function mockPage(page: Page) {
  const registerQueries: string[] = [];
  let aiRecommendCalls = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === '/api/auth/me') body = { authenticated: true, user };
    else if (path === '/api/yucgoutreach/register') {
      registerQueries.push(url.searchParams.get('q') || '');
      body = { items: [REGISTER_HIT], total: 1, limit: 8, offset: 0 };
    } else if (path === '/api/yucg/prospects/ai-recommend') {
      aiRecommendCalls += 1;
      body = { recommendations: [], count: 0, error: 'Model returned no parseable JSON.' };
    } else if (path === '/api/yucg/prospects/recommend') {
      body = {
        recommendations: [
          { prospect: { row_index: 380, company: 'A24', sector: 'Entertainment', why_attractive: 'Independent studio' } },
        ],
        count: 1,
      };
    } else if (path === '/api/contacts/companies/summary') body = [{ company: 'Acme Corp', company_domain: 'acme.com', contact_count: 4 }];
    else if (path === '/api/yucg/prospects') body = { prospects: [], count: 0 };
    else if (path === '/api/yucg/prospects/meta') body = { sectors: [], contact_types: [] };
    else if (path === '/api/yucgoutreach/register/summary') body = { tiers: [], sectors: [], recent_ingests: [] };
    else if (path === '/api/yucgoutreach/runs') body = [];
    else if (path === '/api/outreach/flows') body = [];
    else if (path === '/api/contacts') body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === '/api/ai/models') body = { groups: [] };
    else if (path.startsWith('/api/yucg/rosters')) body = { rosters: [] };
    else if (/\/sequences$|\/custom-formats$/.test(path)) body = [];
    await route.fulfill({ json: body });
  });
  return { registerQueries, aiCalls: () => aiRecommendCalls };
}

test('Find contacts offers two surfaces and reaches the public register from the company field', async ({ page }) => {
  const { registerQueries, aiCalls } = await mockPage(page);
  await page.goto('/scraper');

  // Two doors, not four. Looking up one person and reading email formats are
  // steps inside company work, not destinations of their own.
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Find people' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Company register' })).toBeVisible();

  // Both folded sections are present on the Find people surface, collapsed.
  const onePerson = page.getByRole('group').filter({ hasText: 'Look up one named person' });
  await expect(onePerson).toHaveCount(1);
  await expect(page.getByLabel('Full name')).toBeHidden();
  await page.getByText('Look up one named person').click();
  await expect(page.getByLabel('Full name')).toBeVisible();
  await expect(page.getByText('Company email formats')).toBeVisible();

  // Typing a company reaches the 100k-row register, which cannot be held in
  // the browser, and the row is labelled with where it came from.
  await page.getByLabel('Company', { exact: true }).fill('hansford');
  await expect.poll(() => registerQueries.includes('hansford')).toBe(true);
  const option = page.getByRole('option', { name: /Hansford Sensors Limited/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('hansfordsensors.com');
  await option.click();
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('Hansford Sensors Limited');

  // The curated target list stays, and costs no model call: the AI variant
  // rendered only a name chip here while truncating mid-JSON.
  await expect(page.getByRole('button', { name: 'A24' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Refresh with AI/ })).toHaveCount(0);
  expect(aiCalls()).toBe(0);
});

test('a one-character company does not query the register', async ({ page }) => {
  const { registerQueries } = await mockPage(page);
  await page.goto('/scraper');
  await page.getByLabel('Company', { exact: true }).fill('a');
  await page.waitForTimeout(600);
  expect(registerQueries).toEqual([]);
});
