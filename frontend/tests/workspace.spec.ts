import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = { id: 1, email: 'alice@yale.edu', name: 'Alice', role: 'admin', is_active: 1 };
const campaigns = [
  { id: 1, name: 'Alice outreach', status: 'draft', owner_user_id: 1, sender_user_id: 1, contact_count: 2 },
  { id: 2, name: 'Bob outreach', status: 'draft', owner_user_id: 2, sender_user_id: 2, contact_count: 4 },
  { id: 3, name: 'Legacy outreach', status: 'draft', owner_user_id: null, sender_user_id: null, contact_count: 5 },
];
async function mockWorkspace(page: Page) {
  const mutations: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') mutations.push(`${request.method()} ${path}`);
    let body: unknown = {};
    if (path === '/api/auth/me') body = { authenticated: true, user };
    else if (path === '/api/yucgoutreach/runs') body = [];
    else if (path === '/api/admin/login-log' || path === '/api/settings/custom-formats') body = [];
    else if (path === '/api/admin/projects') body = [{ id: 1, name: 'Consulting project' }];
    else if (path === '/api/admin/invitations') body = [];
    else if (path === '/api/campaigns') body = campaigns;
    else if (path === '/api/campaigns/2') return route.fulfill({ status: 403, json: { detail: 'Only the owner may read this campaign.' } });
    else if (path === '/api/campaigns/3/ownership-evidence') body = { historical_sender_ids: [2], requires_explicit_confirmation: true };
    else if (path === '/api/admin/users') body = [user, { id: 2, email: 'bob@yale.edu', name: 'Bob', role: 'standard', is_active: 1 }];
    else if (path === '/api/auth/gmail/status') body = { connected: false };
    else if (path === '/api/auth/slack/status') body = { connected: false };
    else if (path === '/api/workspace/storage-quota') body = { quota_bytes: 1073741824, reserved_bytes: 24000, available_bytes: 1073717824 };
    else if (path === '/api/workspace/projects') body = [{ id: 1, name: 'Consulting project', semester: 'Fall 2026' }];
    else if (path === '/api/workspace/documents') body = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, title: `Project report ${index + 1}`, owner_user_id: index ? 2 : 1, owner_email: index ? 'bob@yale.edu' : 'alice@yale.edu', project_id: 1, project_name: 'Consulting project', visibility: 'project', current_version: 1, revision: 1 }));
    else if (/\/documents\/\d+\/versions$/.test(path)) body = [{ id: 1, state: 'ready', filename: 'report.pdf', byte_size: 1000, created_at: 1788960000 }];
    else if (/\/documents\/\d+\/shares$/.test(path)) body = [];
    else if (path === '/api/contacts') body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === '/api/ai/models') body = { groups: [] };
    else if (path === '/api/yucg/prospects') body = { prospects: [], count: 0 };
    else if (path === '/api/yucg/prospects/meta') body = { sectors: [], contact_types: [] };
    else if (path === '/api/outreach/metrics/pipeline') body = { by_status: [] };
    else if (path === '/api/analytics/time-series') body = { labels: [], sent: [], opened: [], replied: [] };
    else if (path === '/api/analytics/insights') body = { insights: [] };
    else if (path === '/api/activity/outreach') body = { days: 30, items: [], by_sender: [] };
    else if (path.endsWith('/notification-preferences')) body = { admin_digest: true, campaign_summary: false };
    else if (/\/releases$|\/templates$|\/sequences$|\/generated$|\/my-projects$|\/attachments$|\/companies\/summary$/.test(path)) body = [];
    await route.fulfill({ json: body });
  });
  return mutations;
}

test.beforeEach(async ({ page }) => { await mockWorkspace(page); });

test('campaign summaries never expose another sender’s controls', async ({ page }) => {
  await page.goto('/campaigns');
  const own = page.getByRole('article').filter({ hasText: 'Alice outreach' });
  await expect(own.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  const other = page.getByRole('article').filter({ hasText: 'Bob outreach' });
  await expect(other.getByText('Shared activity · read only')).toBeVisible();
  await expect(other.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  const legacy = page.getByRole('article').filter({ hasText: 'Legacy outreach' });
  await expect(legacy.getByText('Ownership needs review')).toBeVisible();
  await legacy.getByRole('button', { name: 'Review ownership evidence' }).click();
  await expect(legacy.getByText('Recorded senders:', { exact: false })).toContainText('bob@yale.edu');
  await expect(legacy.getByRole('button', { name: 'Review assignment' })).toBeDisabled();
});

test('unauthorized detail displays an error instead of loading forever', async ({ page }) => {
  await page.goto('/campaigns/2');
  await expect(page.getByText('Only the owner may read this campaign.')).toBeVisible();
  await expect(page.getByText('Loading campaign…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review & release' })).toHaveCount(0);
});

test('document owner controls stay separate from project viewing', async ({ page }) => {
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Project report 2', exact: true }).click();
  const details = page.getByRole('region', { name: 'Document details' });
  await expect(details.getByRole('button', { name: 'Download latest' })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Create external share link' })).toHaveCount(0);
  await expect(details.getByLabel('Upload a version', { exact: false })).toHaveCount(0);
});

test('workspace scroll keeps navigation stable without a fixed backdrop', async ({ page }, testInfo) => {
  await page.goto('/documents');
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Project report 24', exact: true })).toBeAttached();
  const header = page.locator('.app-shell-header');
  const before = await header.boundingBox();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const after = await header.boundingBox();
  expect(Math.abs((before?.y || 0) - (after?.y || 0))).toBeLessThan(2);
  expect(await page.locator('main').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
  expect(await page.locator('.app-shell').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('documents-scrolled.png'), fullPage: false });
});

for (const [path, title] of [['/', 'Home'], ['/campaigns', 'Campaigns'], ['/documents', 'Documents'], ['/projects', 'Projects'], ['/profile?tab=integrations', 'Profile & preferences'], ['/studio', 'Drafts'], ['/scraper', 'Prospects'], ['/outreach', 'Pipeline'], ['/analytics', 'Results'], ['/yucgoutreach', 'Outreach week'], ['/admin', 'Admin']]) {
  test(`accessible page: ${title}`, async ({ page }, testInfo) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), path).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: false });
  });
}

test('checking an uncertain dispatch never calls a send endpoint', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && !new URL(request.url()).pathname.startsWith('/api/telemetry/')) mutations.push(new URL(request.url()).pathname); });
  await page.route('**/api/campaigns/1', route => route.fulfill({ json: { ...campaigns[0], readiness: { ready: false, issues: ['Review uncertain delivery'] }, contacts: [] } }));
  await page.route('**/api/campaigns/1/dispatches', route => route.fulfill({ json: [{ dispatch_key: 'initial:1', recipient: 'client@example.com', sender_user_id: 1, state: 'ambiguous' }] }));
  await page.route('**/api/campaigns/1/dispatches/reconcile', route => route.fulfill({ json: { reconciled: false, state: 'ambiguous', reason: 'No confirmed match. Still quarantined.' } }));
  await page.goto('/campaigns/1');
  await page.getByRole('button', { name: 'Check Sent mail', exact: true }).click();
  await expect(page.getByText('No confirmed match. Still quarantined.')).toBeVisible();
  expect(mutations).toEqual(['/api/campaigns/1/dispatches/reconcile']);
});

test('pending file reservations expose recovery only to the owner', async ({ page }) => {
  await page.route('**/api/workspace/documents/1/versions', route => route.fulfill({ json: [{ id: 7, state: 'pending', filename: 'unfinished.pdf', byte_size: 1500, created_at: 1788960000 }] }));
  await page.route('**/api/workspace/documents/1/uploads/7/abandon', route => route.fulfill({ status: 409, json: { detail: 'Upload link has not expired.' } }));
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Project report 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check upload' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel unused upload' }).click();
  await expect(page.getByRole('alert')).toContainText('Upload link has not expired.');
  await expect(page.getByText('unfinished.pdf')).toBeVisible();
});

test('invalid quota is visible and never rendered as NaN', async ({ page }) => {
  await page.route('**/api/workspace/storage-quota', route => route.fulfill({ json: {} }));
  await page.goto('/documents');
  await expect(page.getByRole('alert')).toContainText('Storage usage is unavailable');
  await expect(page.getByText(/NaN/)).toHaveCount(0);
});

test('campaign deletion confirmation contains keyboard focus', async ({ page }) => {
  await page.goto('/campaigns');
  const own = page.getByRole('article').filter({ hasText: 'Alice outreach' });
  await own.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete campaign?' });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Delete campaign', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(own.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
});

const maliciousHtml = '<p><strong>Safe bold</strong> and <em>safe emphasis</em></p><img src="x" onerror="window.__xss=1"><a href="javascript:window.__xss=2">Unsafe link</a><svg onload="window.__xss=3"></svg><script>window.__xss=4</script><iframe srcdoc="<script>parent.__xss=5</script>"></iframe><img src="data:image/svg+xml;base64,PHN2Zy8+"><img alt="Allowed image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqysAAAAASUVORK5CYII=">';

test('untrusted draft and preview HTML cannot execute while formatting remains', async ({ page }) => {
  await page.route('**/api/emails/generated?*', route => route.fulfill({ json: [{ id: 99, user_id: 1, contact_id: 1, name: 'Example recipient', email: 'client@example.com', subject: 'Imported safety fixture', body: maliciousHtml, created_at: '2026-09-09T12:00:00Z' }] }));
  await page.goto('/studio?panel=cache');
  await page.getByText('Imported safety fixture', { exact: true }).click();
  const editor = page.locator('.email-studio-body');
  await expect(editor.locator('strong')).toHaveText('Safe bold');
  await expect(editor.locator('em')).toHaveText('safe emphasis');
  await expect(editor.locator('[onerror], [onload], script, svg, iframe, a[href^="javascript:"], img[src^="data:image/svg"]')).toHaveCount(0);
  await expect(editor.locator('img[alt="Allowed image"]')).toHaveCount(1);
  await expect(page.locator('main [onerror], main [onload], main a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => '__xss' in window)).toBe(false);
});

test('signature load and rich clipboard paste strip active content before insertion', async ({ page }) => {
  await page.route('**/api/settings', route => route.fulfill({ json: { signature: maliciousHtml } }));
  await page.goto('/profile?tab=settings');
  const editor = page.getByRole('textbox', { name: 'Email signature', exact: true });
  await expect(editor.locator('strong')).toHaveText('Safe bold');
  await expect(editor.locator('[onerror], [onload], script, svg, iframe, a[href^="javascript:"]')).toHaveCount(0);
  await editor.focus();
  await editor.evaluate((element, html) => {
    const transfer = new DataTransfer(); transfer.setData('text/html', html);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, maliciousHtml);
  await expect(editor.locator('[onerror], [onload], script, svg, iframe, a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => '__xss' in window)).toBe(false);
});
