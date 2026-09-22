import { expect, test, type Page } from '@playwright/test';

const user = { id: 1, email: 'alice@yale.edu', name: 'Alice', role: 'admin', is_active: 1 };

const PEOPLE = [
  { id: 1, name: 'Jordan Rivers', email: 'jordan@acme.com', title: 'VP Marketing', company: 'Acme Corp' },
  { id: 2, name: 'Sam Lee', email: 'sam@acme.com', title: 'Head of Strategy', company: 'Acme Corp' },
  { id: 3, name: 'Not Chosen', email: 'nc@acme.com', title: 'Analyst', company: 'Acme Corp' },
];

async function mockDrafts(page: Page, { limitAfter = Infinity } = {}) {
  const generated: Record<string, unknown>[] = [];
  const added: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path === '/api/auth/me') body = { authenticated: true, user };
    else if (path === '/api/contacts') body = { items: PEOPLE, total: PEOPLE.length, limit: 800, offset: 0 };
    else if (path === '/api/settings') body = {};
    else if (path === '/api/projects/suggest-citations') body = { projects: [{ id: 1, client_name: 'Google' }], team_experience: [] };
    else if (path === '/api/emails/generate') {
      const sent = request.postDataJSON();
      if (generated.length >= limitAfter) {
        status = 429;
        body = { detail: 'Draft generation limit reached. Please try again later.' };
      } else {
        generated.push(sent);
        body = { subject: 'Three projects', body: '<p>Dear Jordan,</p>', contact_id: sent.contact_id };
      }
    } else if (path === '/api/campaigns' && request.method() === 'POST') body = { id: 7, name: 'Advisory' };
    else if (/\/api\/campaigns\/7\/contacts$/.test(path)) {
      added.push(request.postDataJSON());
      body = { ok: true, added: 1, drafts_attached: 1 };
    } else if (/\/companies\/summary$/.test(path)) body = [];
    else if (/\/releases$|\/templates$|\/sequences$|\/generated$|\/my-projects$|\/attachments$/.test(path)) body = [];
    await route.fulfill({ status, json: body });
  });
  return { generated, added };
}

test('people handed to Drafts each get an advisory draft of their own', async ({ page }) => {
  const { generated, added } = await mockDrafts(page);
  await page.goto('/studio?companies=Acme%20Corp&contact_ids=1%2C2');

  const panel = page.getByTestId('advisory-batch');
  await expect(panel.getByRole('heading', { name: 'Writing to 2 people, one email each' })).toBeVisible();
  // Only the people chosen, not everyone on file at the company.
  await expect(panel.getByText('Not Chosen')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Draft an advisory email for each of these 2' }).click();
  await expect(panel.getByRole('status')).toHaveText('2 drafted');

  expect(generated.map((g) => g.contact_id).sort()).toEqual([1, 2]);
  for (const request of generated) {
    expect(request.angle).toBe('advisory');
    expect(request.length).toBe('standard');
    // Only discussable past clients, from the citations endpoint.
    expect(request.value_proposition).toContain('Past clients we can discuss: Google.');
  }

  // The campaign carries no text of its own: each person's saved draft is used.
  await panel.getByRole('button', { name: 'Save the 2 drafted as a campaign' }).click();
  await expect(panel.getByText(/Campaign #7 saved, nothing sent/)).toBeVisible();
  expect(added).toEqual([{ contact_ids: expect.arrayContaining([1, 2]) }]);
});

test('the hourly draft limit stops the batch and says so, keeping what was drafted', async ({ page }) => {
  const { generated } = await mockDrafts(page, { limitAfter: 1 });
  await page.goto('/studio?companies=Acme%20Corp&contact_ids=1%2C2');

  const panel = page.getByTestId('advisory-batch');
  await panel.getByRole('button', { name: /Draft an advisory email for each/ }).click();
  await expect(panel.getByRole('alert')).toContainText('hourly draft limit');
  await expect(panel.getByRole('status')).toHaveText('1 drafted');
  await expect(panel.getByRole('button', { name: 'Draft the remaining 1' })).toBeEnabled();
  expect(generated).toHaveLength(1);
});

test('ticking people in the Drafts sidebar opens the same per-person panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sidebar is a desktop column');
  await mockDrafts(page);
  await page.goto('/studio');

  await page.getByLabel('Select Jordan Rivers').check();
  await page.getByLabel('Select Sam Lee').check();
  await page.getByRole('button', { name: 'Write to each of these 2 →' }).click();

  const panel = page.getByTestId('advisory-batch');
  await expect(panel.getByRole('heading', { name: 'Writing to 2 people, one email each' })).toBeVisible();
  await expect(page).toHaveURL(/\/studio\?companies=Acme(%20|\+)Corp&contact_ids=1%2C2/);
});
