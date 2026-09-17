import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const project = { id: 1, name: 'Consulting project', semester: 'Fall 2026' };
const spec = {
  industries: ['logistics'], companies: ['Acme'], geography: ['Connecticut'], size: [],
  roles: ['operations'], seniority: ['director'], people_per_company: 1, exclusions: [],
  reason: 'Alumni-led program supporting Connecticut manufacturers',
};

async function mockResearch(page: Page) {
  const mutations: string[] = [];
  let brief = {
    id: 1, project_id: 1, name: 'Spring manufacturers', spec, created_at: '2026-09-01T12:00:00Z',
  };
  let companies = [
    {
      id: 11, brief_id: 1, name: 'Acme', domain: 'acme.com',
      reason: 'Current manufacturer matching the brief.',
      sources: [{ id: 1, url: 'https://acme.com/team', excerpt: 'Acme operates a Connecticut plant.', observed_at: '2026-09-01T12:00:00Z' }],
      match_state: 'possible_match', disposition: null as string | null, warnings: [] as string[],
    },
  ];
  let jobs: Array<Record<string, unknown>> = [];
  let recommendations = [
    {
      id: 21, brief_id: 1,
      person: { name: 'Ada Lovelace', title: 'CTO', company: 'Acme' },
      email: 'ada.lovelace@acme.com',
      evidence: {
        identity: 'plausible', employment: 'current_source_observed',
        address_origin: 'published_by_company', mailbox: 'mail_route_available', project_fit: 'strong',
        checked_at: '2026-09-01T12:00:00Z', method: 'source_review', source_ids: [1],
        reason: 'Named on the current team page.', sources: [{ id: 1, url: 'https://acme.com/team', excerpt: 'Ada Lovelace (ada.lovelace@acme.com) leads engineering at Acme.', observed_at: '2026-09-01T12:00:00Z' }],
        conflicts: [] as string[], recommendation_state: 'ready_to_review',
      },
      state: 'ready_to_review', explanation: 'Named on the current team page with a published address.',
      disposition: null as string | null, contact_id: null as number | null,
    },
  ];

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method !== 'GET') mutations.push(`${method} ${path}`);
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user: { id: 1, email: 'alice@yale.edu', name: 'Alice', role: 'admin', is_active: 1 } } });
    if (path === '/api/workspace/projects') return route.fulfill({ json: [project] });
    if (path === '/api/research/briefs' && method === 'GET') return route.fulfill({ json: { items: [brief] } });
    if (path === '/api/research/briefs' && method === 'POST') {
      const body = request.postDataJSON() as { name: string; project_id: number | null; spec: typeof spec };
      brief = { ...brief, name: body.name, project_id: body.project_id, spec: body.spec };
      return route.fulfill({ json: brief });
    }
    if (path === '/api/research/briefs/1' && method === 'PUT') {
      const body = request.postDataJSON() as { name: string; project_id: number | null; spec: typeof spec };
      brief = { ...brief, name: body.name, project_id: body.project_id, spec: body.spec };
      return route.fulfill({ json: brief });
    }
    if (path === '/api/research/briefs/1/companies' && method === 'POST') return route.fulfill({ json: { items: companies } });
    if (path === '/api/research/briefs/1/companies') return route.fulfill({ json: { items: companies } });
    if (path === '/api/research/companies/11' && method === 'PATCH') {
      const body = request.postDataJSON() as { disposition: string };
      companies = companies.map(company => ({ ...company, disposition: body.disposition }));
      return route.fulfill({ json: companies[0] });
    }
    if (path === '/api/research/jobs' && method === 'POST') {
      jobs = [{ id: 31, brief_id: 1, status: 'running', completed_tasks: 1, total_tasks: 3, people_count: 1, provider_state: 'available' }];
      return route.fulfill({ json: jobs[0] });
    }
    if (path === '/api/research/jobs') return route.fulfill({ json: { items: jobs } });
    if (path === '/api/research/jobs/31/cancel' && method === 'POST') {
      jobs = jobs.map(job => ({ ...job, status: 'cancelled' }));
      return route.fulfill({ json: jobs[0] });
    }
    if (path === '/api/research/jobs/31/resume' && method === 'POST') {
      jobs = jobs.map(job => ({ ...job, status: 'queued' }));
      return route.fulfill({ json: jobs[0] });
    }
    if (path === '/api/research/recommendations') return route.fulfill({ json: { items: recommendations } });
    if (path === '/api/research/recommendations/21/review' && method === 'POST') {
      recommendations = recommendations.map(item => ({ ...item, disposition: 'accepted', contact_id: 99, state: 'ready_to_review' }));
      return route.fulfill({ json: recommendations[0] });
    }
    if (path.startsWith('/api/telemetry')) return route.fulfill({ json: { ok: true } });
    if (path === '/api/contacts') return route.fulfill({ json: { items: [], total: 0, limit: 100, offset: 0 } });
    if (path === '/api/ai/models') return route.fulfill({ json: { groups: [] } });
    return route.fulfill({ json: [] });
  });
  return mutations;
}

test('research journey saves a brief, reviews evidence, and stays keyboard accessible', async ({ page }, testInfo) => {
  const mutations = await mockResearch(page);
  await page.goto('/scraper?view=research');
  await expect(page.getByRole('heading', { level: 1, name: 'Find contacts' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Research' })).toHaveAttribute('aria-selected', 'true');

  await page.getByLabel('Brief name').fill('Spring manufacturers');
  await page.getByLabel('Project scope').selectOption('1');
  await page.getByLabel('Industries').fill('logistics');
  await page.getByLabel('Reason the club can contact this audience').fill('Alumni-led program supporting Connecticut manufacturers');
  await page.getByRole('button', { name: 'Save brief' }).click();
  await expect(page.getByText('Brief saved. Recommendations stay scoped to this brief.')).toBeVisible();

  await page.getByRole('button', { name: 'Research current companies' }).click();
  const company = page.locator('.research-companies li').filter({ hasText: 'acme.com' });
  await expect(company.getByRole('heading', { name: /Acme/ })).toBeVisible();
  await company.getByLabel('Review reason').fill('Matches the manufacturing brief');
  await company.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByText('Acme accepted. Start a research run to find people.')).toBeVisible();

  await page.getByRole('button', { name: 'Find people' }).click();
  await expect(page.getByText('Research run started. You can leave this page; progress is saved.')).toBeVisible();
  const person = page.locator('.research-card').filter({ hasText: 'Ada Lovelace' });
  await expect(person).toBeVisible();
  await expect(person.getByText('Mail domain available')).toBeVisible();
  await expect(person.getByText('Published by company')).toBeVisible();
  await expect(page.getByText(/Verified inbox|Real name/)).toHaveCount(0);

  await person.getByRole('button', { name: 'View evidence' }).click();
  const drawer = page.getByRole('dialog', { name: 'Evidence for Ada Lovelace' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('A mail-domain route does not confirm this individual mailbox.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);

  await page.getByRole('tab', { name: /Needs evidence/ }).press('Enter');
  await expect(page.getByText(/No needs evidence recommendations/i)).toBeVisible();
  await page.getByRole('tab', { name: /Ready to review/ }).press('Enter');
  await expect(person).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('research-journey.png'), fullPage: false });

  await person.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByLabel('Accept reason').fill('Operations lead matches the brief');
  await page.getByRole('button', { name: 'Accept into contacts' }).click();
  await expect.poll(() => mutations.filter(item => item.endsWith('/api/research/recommendations/21/review'))).not.toEqual([]);
});

test('provider exhaustion keeps saved research and never implies a paid fallback', async ({ page }) => {
  await mockResearch(page);
  await page.route('**/api/research/jobs', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { items: [{ id: 31, brief_id: 1, status: 'paused', completed_tasks: 1, total_tasks: 3, people_count: 1, provider_state: 'exhausted' }] } });
    }
    return route.fallback();
  });
  await page.goto('/scraper?view=research');
  await expect(page.getByText('External validation credits are used up for today.')).toBeVisible();
  await expect(page.getByText('No paid provider is ever used automatically.')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
});
