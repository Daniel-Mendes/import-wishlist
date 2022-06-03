
chrome.runtime.onMessage.addListener((request, sender, response) => {
    if (request.type === 'gogToken') {
        let json_parse = JSON.parse(document.getElementsByTagName('pre')[0].innerHTML);
        let access_token = json_parse.access_token;
        let refresh_token = json_parse.refresh_token;
        let user_id = json_parse.user_id;

        chrome.storage.local.set({
            gog_access_token: access_token,
            gog_refresh_token: refresh_token,
            gog_user_id: user_id,
        }, function() {
            chrome.runtime.sendMessage({
                type: 'gogTokenSuccess',
                gog_access_token: access_token,
                gog_user_id: user_id,
            });
        });
    }
});