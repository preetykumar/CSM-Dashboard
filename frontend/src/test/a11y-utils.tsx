import { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { axe, toHaveNoViolations, AxeResults } from "jest-axe";
import { expect } from "vitest";

// Extend expect with axe matchers
expect.extend(toHaveNoViolations);

// Type for axe configuration
interface AxeOptions {
  rules?: Record<string, { enabled: boolean }>;
  runOnly?: {
    type: "tag" | "rule";
    values: string[];
  };
}

/**
 * Renders a component and runs axe accessibility checks
 * @param ui - React component to test
 * @param options - Render options
 * @param axeOptions - Axe configuration options
 * @returns The axe results
 */
export async function checkA11y(
  ui: ReactElement,
  options?: RenderOptions,
  axeOptions?: AxeOptions
): Promise<AxeResults> {
  const { container } = render(ui, options);
  const results = await axe(container, axeOptions);
  return results;
}

/**
 * Helper to check accessibility and assert no violations
 * @param ui - React component to test
 * @param options - Render options
 * @param axeOptions - Axe configuration options
 */
export async function expectNoA11yViolations(
  ui: ReactElement,
  options?: RenderOptions,
  axeOptions?: AxeOptions
): Promise<void> {
  const results = await checkA11y(ui, options, axeOptions);
  expect(results).toHaveNoViolations();
}

/**
 * Format axe violations for better error messages
 * @param violations - Array of axe violations
 * @returns Formatted string
 */
export function formatViolations(violations: AxeResults["violations"]): string {
  if (violations.length === 0) {
    return "No accessibility violations found";
  }

  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `    - ${node.html}\n      ${node.failureSummary}`)
        .join("\n");

      return `
[${violation.impact?.toUpperCase()}] ${violation.id}: ${violation.description}
  Help: ${violation.helpUrl}
  Affected nodes:
${nodes}`;
    })
    .join("\n");
}

/**
 * Common axe rules to run for WCAG 2.1 AA compliance
 */
export const wcag21AAConfig: AxeOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  },
};

/**
 * Best practices config including additional rules
 */
export const bestPracticesConfig: AxeOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
  },
};
