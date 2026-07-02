import { test, expect, Page } from '@playwright/test';

async function getStatus(page: Page) {
	return page.locator('#status').textContent();
}

async function waitForReady(page: Page) {
	// Wait for status to be set (not "Loading...")
	await page.locator('#status').waitFor({ state: 'visible' });
	await page.waitForFunction(
		() => (document.getElementById('status')?.textContent || '') !== 'Loading...'
	);
}

test.describe('Consentify IIFE', () => {
	test('IIFE smoke: page loads and window.Consentify is defined', async ({ page }) => {
		await page.goto('/');
		const consentifyDefined = await page.evaluate(() => typeof window.Consentify !== 'undefined');
		expect(consentifyDefined).toBe(true);

		await waitForReady(page);
		const status = await getStatus(page);
		expect(status).toBe('unset');
	});

	test('Persistence: accept writes cookie, reload restores state', async ({ page, context }) => {
		await page.goto('/');
		await waitForReady(page);

		// Accept all
		await page.click('#accept');
		await expect(page.locator('#status')).toContainText('decided');
		await expect(page.locator('#status')).toContainText('analytics:true');
		await expect(page.locator('#status')).toContainText('marketing:true');

		// Check cookie exists
		const cookies = await context.cookies();
		const consentifyCookie = cookies.find((c) => c.name === 'consentify');
		expect(consentifyCookie).toBeDefined();

		// Reload and verify state persisted
		await page.reload();
		const status = await getStatus(page);
		expect(status).toContain('decided');
		expect(status).toContain('analytics:true');
		expect(status).toContain('marketing:true');
	});

	test('Cross-tab sync: BroadcastChannel syncs state between pages', async ({ page, context }) => {
		// Open first page
		const page1 = await context.newPage();
		await page1.goto('/');
		await waitForReady(page1);
		expect(await getStatus(page1)).toBe('unset');

		// Open second page in same context
		const page2 = await context.newPage();
		await page2.goto('/');
		await waitForReady(page2);
		expect(await getStatus(page2)).toBe('unset');

		// Accept in page1
		await page1.click('#accept');
		await expect(page1.locator('#status')).toContainText('decided');

		// page2 should sync via BroadcastChannel
		await expect(page2.locator('#status')).toContainText('decided', { timeout: 5000 });
		await expect(page2.locator('#status')).toContainText('analytics:true');
		await expect(page2.locator('#status')).toContainText('marketing:true');

		// Clear in page2
		await page2.click('#clear');
		await expect(page2.locator('#status')).toContainText('unset');

		// page1 should sync back to unset
		await expect(page1.locator('#status')).toContainText('unset', { timeout: 5000 });

		await page1.close();
		await page2.close();
	});
});
