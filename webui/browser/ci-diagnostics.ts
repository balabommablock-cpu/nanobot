import type { Page, TestInfo } from "@playwright/test";

declare global {
  interface Window {
    __ciDiagnostic?: (record: Record<string, unknown>) => void;
    __ciDiagnosticRecords?: Record<string, unknown>[];
  }
}

export async function installCiDiagnostics(page: Page) {
  await page.addInitScript(() => {
    const records: Record<string, unknown>[] = [];
    window.__ciDiagnosticRecords = records;
    window.__ciDiagnostic = (record) => {
      records.push({ at: performance.now(), ...record });
      if (records.length > 2500) records.shift();
    };
    const element = (node: Element | null) => node ? {
      tag: node.tagName, id: node.id, className: node.getAttribute("class"),
      testId: node.getAttribute("data-testid"), role: node.getAttribute("role"),
    } : null;
    const describe = (event: Event, phase: string) => {
      const target = event.target instanceof Element ? event.target : null;
      const viewport = document.querySelector<HTMLElement>("[data-testid=thread-message-region]");
      const trigger = document.querySelector<HTMLElement>("[data-testid=subagent-task-dock-trigger]");
      const detail: Record<string, unknown> = {
        source: "native", phase, type: event.type, prevented: event.defaultPrevented,
        target: element(target), active: element(document.activeElement),
        scrollTop: viewport?.scrollTop, expanded: trigger?.getAttribute("aria-expanded"),
        tree: Boolean(document.querySelector("[data-testid=subagent-task-tree]")),
        transform: viewport ? getComputedStyle(viewport).transform : null,
      };
      if (event instanceof KeyboardEvent) Object.assign(detail, { key: event.key, composing: event.isComposing });
      if (event instanceof PointerEvent) Object.assign(detail, { x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, button: event.button });
      if (event instanceof MouseEvent) detail.clickDetail = event.detail;
      if (event instanceof TouchEvent) Object.assign(detail, { touches: Array.from(event.touches, touch => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY })), changed: Array.from(event.changedTouches, touch => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY })) });
      window.__ciDiagnostic?.(detail);
    };
    for (const type of ["keydown", "pointerdown", "pointerup", "pointercancel", "lostpointercapture", "click", "touchstart", "touchmove", "touchend", "touchcancel", "wheel", "scroll"]) {
      window.addEventListener(type, event => describe(event, "capture"), true);
      if (type === "keydown") window.addEventListener(type, event => describe(event, "bubble"));
    }
  });
}

export async function saveCiDiagnostics(page: Page, info: TestInfo, label: string) {
  const data = await page.evaluate(() => ({
    url: location.href,
    records: window.__ciDiagnosticRecords ?? [],
    body: document.body.innerText.slice(0, 3000),
    active: document.activeElement?.outerHTML,
  })).catch(error => ({ error: String(error) }));
  const body = JSON.stringify(data, null, 2);
  console.log(`CI_DIAGNOSTICS ${label} ${body}`);
  await info.attach(`ci-diagnostics-${label}`, { body, contentType: "application/json" });
}
