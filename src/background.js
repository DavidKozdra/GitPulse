chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension Installed");
  });
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "open-url") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs.length || !tabs[0].url) {
          alert("Cannot access the current tab URL. Make sure you're on a regular webpage.");
          return;
        }
      
      });
    }
  });
  