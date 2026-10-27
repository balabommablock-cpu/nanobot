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
      records.push({ at: performance.now(), wallTime: Date.now(), ...record });
      if (records.length > 2500) records.shift();
    };
    const preventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (this instanceof KeyboardEvent && this.key === "Escape") {
        window.__ciDiagnostic?.({ source: "native", type: "escape-prevent-default", stack: new Error().stack });
      }
      return preventDefault.call(this);
    };
    const elementIds = new WeakMap<Element, number>();
    let nextElementId = 1;
    const element = (node: Element | null) => {
      if (!node) return null;
      if (!elementIds.has(node)) elementIds.set(node, nextElementId++);
      return {
        diagnosticId: elementIds.get(node), tag: node.tagName, id: node.id, className: node.getAttribute("class"),
        testId: node.getAttribute("data-testid"), role: node.getAttribute("role"), connected: node.isConnected,
      };
    };
    let touchTarget: Element | null = null;
    let targetDetached = false;
    window.addEventListener("touchstart", event => {
      if (event.touches.length !== 1) return;
      touchTarget = event.target instanceof Element ? event.target : null;
      targetDetached = false;
    }, true);
    new MutationObserver(() => {
      if (!touchTarget || touchTarget.isConnected || targetDetached) return;
      targetDetached = true;
      window.__ciDiagnostic?.({ source: "native", type: "touch-target-detached", target: element(touchTarget) });
    }).observe(document, { subtree: true, childList: true });
    const describe = (event: Event, phase: string) => {
      const target = event.target instanceof Element ? event.target : null;
      const viewport = document.querySelector<HTMLElement>("[data-testid=thread-message-region]");
      const trigger = document.querySelector<HTMLElement>("[data-testid=subagent-task-dock-trigger]");
      const detail: Record<string, unknown> = {
        source: "native", phase, type: event.type, prevented: event.defaultPrevented,
        target: element(target), active: element(document.activeElement),
        path: event.composedPath().filter((item): item is Element => item instanceof Element).map(element).slice(0, 12),
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
      if (type === "keydown" || type.startsWith("touch")) window.addEventListener(type, event => describe(event, "bubble"));
    }
    let lastFrame = 0;
    const heartbeat = (at: number) => {
      if (at - lastFrame >= 250) {
        lastFrame = at;
        window.__ciDiagnostic?.({ source: "frame", type: "heartbeat", hidden: document.hidden, touchTarget: element(touchTarget) });
      }
      requestAnimationFrame(heartbeat);
    };
    requestAnimationFrame(heartbeat);
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
