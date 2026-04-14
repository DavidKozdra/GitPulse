const MENU_ID = "copy-selected-tab-urls";
const MESSAGE_COPY_SELECTED = "copy-selected-tab-urls";
const MESSAGE_COPY_ALL = "copy-all-tab-urls";

function getApi() {
  return typeof chrome !== "undefined" ? chrome : browser;
}

function queryTabs(queryInfo) {
  const api = getApi();
  if (api.tabs && typeof api.tabs.query === "function" && typeof chrome !== "undefined") {
    return new Promise((resolve) => api.tabs.query(queryInfo, resolve));
  }
  return api.tabs.query(queryInfo);
}

function getHighlightedTabs() {
  return queryTabs({ currentWindow: true, highlighted: true });
}

function getAllVisibleTabs() {
  return queryTabs({ currentWindow: true });
}

function urlsFromTabs(tabs) {
  return (tabs || [])
    .map((tab) => tab && tab.url)
    .filter((url) => typeof url === "string" && url.length > 0);
}

async function copyText(text) {
  if (!text) return false;

  const api = getApi();

  if (typeof chrome !== "undefined" && api.scripting && api.tabs) {
    const [activeTab] = await queryTabs({ active: true, currentWindow: true });
    if (activeTab && activeTab.id != null) {
      await api.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: async (value) => {
          const area = document.createElement("textarea");
          area.value = value;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        },
        args: [text],
      });
      return true;
    }
  }

  if (typeof browser !== "undefined" && browser.tabs && typeof browser.tabs.executeScript === "function") {
    const [activeTab] = await queryTabs({ active: true, currentWindow: true });
    if (activeTab && activeTab.id != null) {
      await browser.tabs.executeScript(activeTab.id, {
        code: `(() => {
          const value = ${JSON.stringify(text)};
          const area = document.createElement("textarea");
          area.value = value;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        })();`,
      });
      return true;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  throw new Error("Clipboard API unavailable");
}

function createMenu() {
  const api = getApi();
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: MENU_ID,
      title: "Copy selected tab URLs",
      contexts: ["page"],
    });
  });
}

async function copySelectedTabs() {
  const tabs = await getHighlightedTabs();
  return copyText(urlsFromTabs(tabs).join("\n"));
}

async function copyAllTabs() {
  const tabs = await getAllVisibleTabs();
  return copyText(urlsFromTabs(tabs).join("\n"));
}

function handleMenuClick(info) {
  if (info.menuItemId !== MENU_ID) return;
  copySelectedTabs().catch((err) => console.error("Failed to copy selected tab URLs:", err));
}

function handleCommand(command) {
  if (command === "copy-selected-tab-urls") {
    copySelectedTabs().catch((err) => console.error("Failed to copy selected tab URLs:", err));
  }

  if (command === "copy-all-tab-urls") {
    copyAllTabs().catch((err) => console.error("Failed to copy all tab URLs:", err));
  }
}

function handleMessage(message, sender, sendResponse) {
  if (!message || typeof message.action !== "string") return;

  if (message.action === MESSAGE_COPY_SELECTED) {
    copySelectedTabs()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.action === MESSAGE_COPY_ALL) {
    copyAllTabs()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
}

const api = getApi();

api.runtime.onInstalled.addListener(createMenu);
api.runtime.onStartup?.addListener(createMenu);
api.contextMenus.onClicked.addListener(handleMenuClick);
api.commands?.onCommand?.addListener(handleCommand);
api.runtime.onMessage.addListener(handleMessage);
