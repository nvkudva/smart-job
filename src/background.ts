chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Ollama answers 403 to chrome-extension:// origins unless OLLAMA_ORIGINS is set. Dropping the Origin header
// only for requests this extension makes keeps other websites unable to reach the local model.
const ollamaOriginRule: chrome.declarativeNetRequest.Rule = {
  id: 1,
  priority: 1,
  action: {
    type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
    requestHeaders: [{ header: "origin", operation: "remove" as chrome.declarativeNetRequest.HeaderOperation }],
  },
  condition: {
    regexFilter: "^http://(localhost|127\\.0\\.0\\.1):11434/",
    initiatorDomains: [chrome.runtime.id],
    resourceTypes: ["xmlhttprequest" as chrome.declarativeNetRequest.ResourceType],
  },
};

chrome.declarativeNetRequest
  .updateSessionRules({ removeRuleIds: [ollamaOriginRule.id], addRules: [ollamaOriginRule] })
  .catch(console.error);
