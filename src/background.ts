chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Local and private-network servers (Ollama, LM Studio, llama.cpp) answer 403 to chrome-extension:// origins unless allow-listed. Dropping the Origin header
// only for requests this extension makes keeps other websites unable to reach the local model.
const ollamaOriginRule: chrome.declarativeNetRequest.Rule = {
  id: 1,
  priority: 1,
  action: {
    type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
    requestHeaders: [{ header: "origin", operation: "remove" as chrome.declarativeNetRequest.HeaderOperation }],
  },
  condition: {
    regexFilter: "^http://(localhost|127\\.0\\.0\\.1|192\\.168\\.[0-9]+\\.[0-9]+|10\\.[0-9]+\\.[0-9]+\\.[0-9]+|172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]+\\.[0-9]+)(:[0-9]+)?/",
    initiatorDomains: [chrome.runtime.id],
    resourceTypes: ["xmlhttprequest" as chrome.declarativeNetRequest.ResourceType],
  },
};

chrome.declarativeNetRequest
  .updateSessionRules({ removeRuleIds: [ollamaOriginRule.id], addRules: [ollamaOriginRule] })
  .catch(console.error);
