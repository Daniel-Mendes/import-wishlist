
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "gogGetAccessToken") {
        const jsonParse = JSON.parse(document.getElementsByTagName("pre")[0].innerHTML);
        const accessToken = jsonParse.access_token;
        const refreshToken = jsonParse.refresh_token;
        const userId = jsonParse.user_id;

        chrome.storage.local.set({
            "gog_access_token": accessToken,
            "gog_refresh_token": refreshToken,
            "gog_user_id": userId,
        }, () => {
            chrome.runtime.sendMessage({
                "type": "gogAccessTokenSuccess",
            });
        });
    }
});
