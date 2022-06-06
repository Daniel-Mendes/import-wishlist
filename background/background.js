chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url && tab.url.includes("https://embed.gog.com/on_login_success?origin=client") && tab.status === "complete" && changeInfo.status === "complete") {
        const queryParameters = tab.url.split("?")[1];
        const urlParameters = new URLSearchParams(queryParameters);

        chrome.runtime.sendMessage({
            "type": "gogLogin",
            "code": urlParameters.get("code")
        });
    }

    if (tab.url && tab.url.includes("https://auth.gog.com/token?client_id=46899977096215655&client_secret=9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9") && tab.status === "complete" && changeInfo.status === "complete") {
        chrome.tabs.sendMessage(tab.id, {
            "type": "gogToken"
        });
    }
});
