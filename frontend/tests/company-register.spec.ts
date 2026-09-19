import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'alice@yale.edu', name: 'Alice', role: 'admin', is_active: 1 };

const UK_ROW = { id: 3, source: 'companies_house', tier: 'uk', country: 'GB', company_name: 'Hansford Sensors Limited', sector_label: 'Manufacture of electronic industrial process control equipment', region: 'High Wycombe', employees: null, employees_source: 'companies_house_account_category', last_event_at: '2025-12-31', last_event_amount: null, last_event_kind: 'accounts_filed', officer_count: 0, metadata: { size_band: 'group (consolidated accounts)' } };

const ROWS = [
  { id: 1, source: 'sec_form_d', tier: 'us_private', country: 'US', company_name: 'Gilgamesh Pharma Inc.', sector_label: 'Pharmaceuticals', region: 'New York', employees: null, employees_source: null, last_event_at: '2026-03-27', last_event_amount: 15000000, last_event_kind: 'reg_d_offering', officer_count: 6, metadata: { revenue_range: 'No Revenues' } },
  { id: 2, source: 'sec_form_d', tier: 'us_private', country: 'US', company_name: 'Lucem Health, Inc.', sector_label: 'Other Technology', region: 'North Carolina', employees: null, employees_source: null, last_event_at: '2026-03-26', last_event_amount: 8397541, last_event_kind: 'reg_d_offering', officer_count: 6, metadata: {} },
];

async function mockRegister(page: Page) {
  const calls: string[] = [];
  const fetched: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === '/api/auth/me') body = { authenticated: true, user };
    else if (path === '/api/yucgoutreach/register/summary') body = {
      tiers: [{ tier: 'us_public', country: 'US', n: 8031, with_officers: 0 }, { tier: 'us_private', country: 'US', n: 1563, with_officers: 1556 }, { tier: 'uk', country: 'GB', n: 82819, with_officers: 0 }],
      sectors: [{ sector: 'Other Technology', n: 505 }, { sector: 'Biotechnology', n: 108 }],
      recent_ingests: [],
    };
    else if (path === '/api/yucgoutreach/register') {
      calls.push(url.search);
      const tier = url.searchParams.get('tier');
      const sector = url.searchParams.get('sector');
      let items = [...ROWS, UK_ROW].filter(r => !tier || r.tier === tier);
      if (sector) items = items.filter(r => r.sector_label === sector);
      body = { items, total: items.length, limit: 40, offset: 0 };
    }
    else if (/\/register\/\d+\/people$/.test(path) && route.request().method() === 'POST') {
      fetched.push(path);
      body = { ok: true, attached: 2, officer_count: 2 };
    }
    else if (/\/register\/\d+\/people$/.test(path)) body = [
      { full_name: 'Ada Lovelace', relationship: 'Executive Officer', source_url: 'https://www.sec.gov/Archives/edgar/data/1/x/' },
      { full_name: 'Grace Hopper', relationship: 'Director' },
    ];
    else if (path === '/api/yucgoutreach/runs') body = [];
    else if (path === '/api/outreach/flows') body = [];
    else if (path === '/api/contacts') body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === '/api/yucg/prospects') body = { prospects: [], count: 0 };
    else if (path === '/api/yucg/prospects/meta') body = { sectors: [], contact_types: [] };
    else if (path === '/api/ai/models') body = { groups: [] };
    else if (path.startsWith('/api/yucg/rosters')) body = { rosters: [] };
    else if (/\/companies\/summary$|\/sequences$|\/custom-formats$/.test(path)) body = [];
    await route.fulfill({ json: body });
  });
  return { calls, fetched };
}

test('register browses the free public pool and hands a company to Find people', async ({ page }) => {
  const { calls } = await mockRegister(page);
  await page.goto('/scraper');
  await page.getByRole('tab', { name: 'Company register' }).click();

  // Defaults to the startup pool and states what is on record.
  await expect(page.getByText('8,031 listed · 1,563 recently funded · 82,819 UK · 1,556 with named officers')).toBeVisible();
  await expect(page.getByText('Gilgamesh Pharma Inc.')).toBeVisible();
  await expect(page.getByText(/Pharmaceuticals · New York · raised \$15M · 2026-03-27/)).toBeVisible();

  // Officers come from the company's own filing, on demand.
  await page.getByRole('button', { name: /6 officer\(s\) on file/ }).first().click();
  await expect(page.getByText('Ada Lovelace (Executive Officer), Grace Hopper (Director)')).toBeVisible();

  // Sector filter narrows the pool.
  await page.getByLabel('Sector', { exact: true }).selectOption('Biotechnology');
  await expect(page.getByText('0 matches')).toBeVisible();
  await page.getByLabel('Sector', { exact: true }).selectOption('Other Technology');
  await expect(page.getByText('Lucem Health, Inc.')).toBeVisible();

  // UK tier shows Companies House rows with their statutory size band, and
  // never an invented employee count.
  await page.getByLabel('Sector', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'UK' }).click();
  await expect(page.getByText('Hansford Sensors Limited')).toBeVisible();
  await expect(page.getByText(/High Wycombe · group \(consolidated accounts\)/)).toBeVisible();
  await expect(page.getByText(/employees \(/)).toHaveCount(0);

  // Tier switch asks the API for listed companies.
  await page.getByRole('button', { name: 'US listed' }).click();
  await expect.poll(() => calls.some(search => search.includes('tier=us_public'))).toBe(true);

  // Handing a company to Find people fills the form.
  await page.getByRole('button', { name: 'Recently funded' }).click();
  await page.getByLabel('Sector', { exact: true }).selectOption('');   // clear the sector narrowing
  await expect(page.getByText('Gilgamesh Pharma Inc.')).toBeVisible();
  await page.getByRole('button', { name: 'Find people here' }).first().click();
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('Gilgamesh Pharma Inc.');
  await page.screenshot({ path: 'test-results/company-register.png', fullPage: true });
});

test('a listed or UK company with no officers on file can be looked up on demand', async ({ page }) => {
  const { fetched } = await mockRegister(page);
  await page.goto('/scraper');
  await page.getByRole('tab', { name: 'Company register' }).click();
  await page.getByRole('button', { name: 'UK' }).click();

  // The bulk Companies House file carries no people, so the row arrives empty
  // and offers to read the per-company register instead of showing nothing.
  const row = page.getByRole('listitem').filter({ hasText: 'Hansford Sensors Limited' });
  await expect(row.getByRole('button', { name: 'Look up officers' })).toBeVisible();
  await row.getByRole('button', { name: 'Look up officers' }).click();

  await expect.poll(() => fetched.length).toBe(1);
  await expect(page.getByText('Ada Lovelace (Executive Officer), Grace Hopper (Director)')).toBeVisible();
  // Once they are on file the offer is gone: no second call against a
  // rate-limited public API.
  await expect(row.getByRole('button', { name: 'Look up officers' })).toHaveCount(0);
});
