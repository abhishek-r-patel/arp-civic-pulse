import { expect, type Page } from "@playwright/test";

export async function chooseDropdownOption(
  page: Page,
  label: string,
  option: string,
) {
  const trigger = page.getByRole("combobox", { name: label });
  await trigger.click();
  const menu = page.getByRole("listbox", { name: label });
  await expect(menu).toBeVisible();
  const [triggerBounds, menuBounds] = await Promise.all([
    trigger.boundingBox(),
    menu.boundingBox(),
  ]);
  if (!triggerBounds || !menuBounds) {
    throw new Error(`Could not measure the "${label}" dropdown bounds.`);
  }
  expect(Math.abs(menuBounds.x - triggerBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(menuBounds.width - triggerBounds.width)).toBeLessThanOrEqual(
    1,
  );
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}
