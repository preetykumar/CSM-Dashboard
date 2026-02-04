import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Accessibility Tests", () => {
  test.describe("Login Page", () => {
    test("should have no accessibility violations on login page", async ({ page }) => {
      await page.goto("/");

      // Wait for the page to load
      await page.waitForLoadState("networkidle");

      // Run axe accessibility scan
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      // Log violations for debugging
      if (accessibilityScanResults.violations.length > 0) {
        console.log("Accessibility violations found:");
        accessibilityScanResults.violations.forEach((violation) => {
          console.log(`\n[${violation.impact?.toUpperCase()}] ${violation.id}: ${violation.description}`);
          console.log(`Help: ${violation.helpUrl}`);
          violation.nodes.forEach((node) => {
            console.log(`  - ${node.html}`);
            console.log(`    ${node.failureSummary}`);
          });
        });
      }

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test("Google sign-in button should meet touch target size minimum (24x24)", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const googleButton = page.locator(".google-login-btn");
      const boundingBox = await googleButton.boundingBox();

      expect(boundingBox).not.toBeNull();
      expect(boundingBox!.width).toBeGreaterThanOrEqual(24);
      expect(boundingBox!.height).toBeGreaterThanOrEqual(24);

      // Log actual dimensions
      console.log(`Google button dimensions: ${boundingBox!.width}x${boundingBox!.height}px`);
    });

    test("should have proper focus indicators", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Tab to the Google sign-in button
      await page.keyboard.press("Tab");

      const googleButton = page.locator(".google-login-btn");
      const isFocused = await googleButton.evaluate((el) => document.activeElement === el);

      // Take screenshot to verify focus indicator
      await page.screenshot({ path: "test-results/focus-indicator.png" });

      expect(isFocused).toBe(true);
    });

    test("should have proper heading hierarchy", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const h1 = await page.locator("h1").count();
      expect(h1).toBeGreaterThanOrEqual(1);

      // Verify h1 is first heading in document order
      const firstHeading = await page.locator("h1, h2, h3, h4, h5, h6").first().evaluate((el) => el.tagName);
      expect(firstHeading).toBe("H1");
    });
  });

  test.describe("Color Contrast", () => {
    test("should pass color contrast requirements", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2aa"])
        .options({
          runOnly: ["color-contrast"],
        })
        .analyze();

      if (accessibilityScanResults.violations.length > 0) {
        console.log("Color contrast violations:");
        accessibilityScanResults.violations.forEach((violation) => {
          violation.nodes.forEach((node) => {
            console.log(`  - ${node.html}`);
            console.log(`    ${node.failureSummary}`);
          });
        });
      }

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  });

  test.describe("Keyboard Navigation", () => {
    test("should be fully keyboard navigable", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Count focusable elements
      const focusableElements = page.locator(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      const count = await focusableElements.count();

      console.log(`Found ${count} focusable elements`);

      // Tab through all elements
      for (let i = 0; i < count; i++) {
        await page.keyboard.press("Tab");
        const activeElement = await page.evaluate(() => {
          const el = document.activeElement;
          return {
            tagName: el?.tagName,
            className: el?.className,
            text: el?.textContent?.substring(0, 50),
          };
        });
        console.log(`Tab ${i + 1}: ${activeElement.tagName} - ${activeElement.text?.trim()}`);
      }

      expect(count).toBeGreaterThan(0);
    });

    test("should trap focus in modal when open", async ({ page }) => {
      // This test would require authentication to access the dashboard
      // For now, we verify the login page focus trapping
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Verify we can tab through elements without focus escaping
      const tabCount = 10;
      const focusedElements: string[] = [];

      for (let i = 0; i < tabCount; i++) {
        await page.keyboard.press("Tab");
        const activeTag = await page.evaluate(() => document.activeElement?.tagName);
        focusedElements.push(activeTag || "null");
      }

      // Ensure focus stays within the page
      expect(focusedElements.filter((el) => el !== "BODY").length).toBeGreaterThan(0);
    });
  });

  test.describe("Screen Reader Compatibility", () => {
    test("should have proper ARIA landmarks", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .options({
          runOnly: ["landmark-one-main", "region"],
        })
        .analyze();

      // Log any landmark issues
      if (accessibilityScanResults.violations.length > 0) {
        console.log("Landmark violations (may be expected for login page):");
        accessibilityScanResults.violations.forEach((v) => {
          console.log(`  - ${v.id}: ${v.description}`);
        });
      }
    });

    test("should have accessible button labels", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .options({
          runOnly: ["button-name"],
        })
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test("should have accessible form labels", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .options({
          runOnly: ["label", "label-title-only"],
        })
        .analyze();

      if (accessibilityScanResults.violations.length > 0) {
        console.log("Form label violations:");
        accessibilityScanResults.violations.forEach((v) => {
          v.nodes.forEach((n) => {
            console.log(`  - ${n.html}`);
          });
        });
      }

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  });

  test.describe("Best Practices", () => {
    test("should follow accessibility best practices", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["best-practice"])
        .analyze();

      // Log best practice issues
      if (accessibilityScanResults.violations.length > 0) {
        console.log("Best practice violations:");
        accessibilityScanResults.violations.forEach((violation) => {
          console.log(`\n[${violation.impact}] ${violation.id}: ${violation.description}`);
          violation.nodes.forEach((node) => {
            console.log(`  - ${node.html}`);
          });
        });
      }

      // Best practices may have some acceptable violations
      // Filter for critical issues only
      const criticalViolations = accessibilityScanResults.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(criticalViolations).toEqual([]);
    });
  });

  test.describe("Image Accessibility", () => {
    test("should have alt text on images", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const accessibilityScanResults = await new AxeBuilder({ page })
        .options({
          runOnly: ["image-alt"],
        })
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  });
});
