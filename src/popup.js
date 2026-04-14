document.addEventListener("DOMContentLoaded", async () => {
  const statusText = document.getElementById("statusText");
  const copySelectedBtn = document.getElementById("copySelectedBtn");
  const copyAllBtn = document.getElementById("copyAllBtn");

  const setStatus = (text) => {
    if (statusText) statusText.textContent = text;
  };

  const run = async (action, successText) => {
    setStatus("Copying...");
    const response = await ext.sendMessage({ action });
    if (response && response.ok) {
      setStatus(successText);
    } else {
      setStatus("Copy failed");
    }
  };

  copySelectedBtn?.addEventListener("click", () => {
    run("copy-selected-tab-urls", "Selected tabs copied");
  });

  copyAllBtn?.addEventListener("click", () => {
    run("copy-all-tab-urls", "All tabs copied");
  });
});
