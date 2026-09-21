import { expect, test, type Page } from '@playwright/test';

const STATUS = {
  row_count: 620,
  source_exists: true,
  source_kind: 'file',
  last_upload: { created_at: '2026-09-18 10:04:00', details: 'spring-2026.xlsx: 620 companies (was 604)', name: 'Chair', email: 'chair@yale.edu' },
};

async function mockPage(page: Page, role: 'admin' | 'standard') {
  const uploads: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === '/api/auth/me') {
      body = { authenticated: true, user: { id: 1, email: 'chair@yale.edu', name: 'Chair', role, is_active: 1 } };
    } else if (path === '/api/admin/target-list') {
      if (route.request().method() === 'POST') {
        uploads.push(route.request().url());
        body = { ok: true, companies: 640, companies_before: 620, register_rows_written: 638, register_rows_dropped: 3, folded_duplicates: ['Google', 'Uber'], replaced_copy: '/data/versions/list.xlsx' };
      } else {
        body = STATUS;
      }
    } else if (path === '/api/yucgoutreach/register') body = { items: [], total: 0, limit: 8, offset: 0 };
    else if (path === '/api/yucgoutreach/register/summary') body = { tiers: [], sectors: [], recent_ingests: [] };
    else if (path === '/api/contacts') body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === '/api/contacts/companies/summary') body = [];
    else if (path === '/api/yucg/prospects/meta') body = { sectors: [], contact_types: [] };
    else if (path === '/api/ai/models') body = { groups: [] };
    else if (/\/sequences$|\/custom-formats$/.test(path)) body = [];
    await route.fulfill({ json: body });
  });
  return uploads;
}

test('an admin replaces the club target list from the import tab', async ({ page }) => {
  const uploads = await mockPage(page, 'admin');
  await page.goto('/scraper?view=import');

  const kind = page.getByLabel('What is in this file?');
  await expect(kind).toBeVisible();
  await kind.selectOption('club_targets');

  // The list already on file is stated, so replacing it is a decision rather
  // than a guess about what is about to be overwritten.
  await expect(page.getByTestId('target-list-status')).toContainText('620');
  await expect(page.getByTestId('target-list-status')).toContainText('Chair');

  await page.setInputFiles('input[type="file"]', {
    name: 'spring-2026.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('PK fixture'),
  });

  expect(uploads).toHaveLength(1);
  // What changed, including what left the club tier and what merged - a
  // silent removal or merge is the thing a member would notice days later and
  // not be able to explain.
  const result = page.getByText(/Club target list replaced/);
  await expect(result).toContainText('640 sheet lines (was 620)');
  await expect(result).toContainText('3 removed');
  await expect(result).toContainText('Google, Uber');
});

test('a member is not offered the club target list', async ({ page }) => {
  await mockPage(page, 'standard');
  await page.goto('/scraper?view=import');

  const kind = page.getByLabel('What is in this file?');
  await expect(kind).toBeVisible();
  await expect(kind.getByRole('option')).toHaveText(['People to add to contacts']);
});
