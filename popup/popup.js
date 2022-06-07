function alert(message, timeout) {
    document.getElementById("alert").innerText = message;
    document.getElementById("alert").style.display = "block";
    setTimeout(() => {
        document.getElementById("alert").style.display = "none";
    }, timeout);
}

function setSteamDetails(steamUserId) {
    fetch(`https://steamcommunity.com/profiles/${steamUserId}/?xml=1`)
        .then(response => {
            response.text()
                .then((content) => {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(content, "text/xml");
                    return xmlDoc;
                })
                .then(xmlDoc => {
                    document.getElementById("btn-steam-login").style.display = "none";
                    document.getElementById("steam-avatar").src
                        = xmlDoc.getElementsByTagName("avatarFull")[0].childNodes[0].nodeValue;
                    document.getElementById("steam-name").href
                        = `https://store.steampowered.com/wishlist/id/${xmlDoc.getElementsByTagName("customURL")[0].childNodes[0].nodeValue}`;
                    document.getElementById("steam-name").innerText
                        = xmlDoc.getElementsByTagName("steamID")[0].childNodes[0].nodeValue;
                    document.getElementById("details-steam").style.display = "block";
                });
        });
}

function setGogDetails(gogAccessToken) {
    fetch("https://menu.gog.com/v1/account/basic", {
        "headers": {
            "Authorization": `Bearer ${gogAccessToken}`,
        }
    })
        .then(response => {
            return response.json();
        })
        .then(data => {
            document.getElementById("btn-gog-login").style.display = "none";
            document.getElementById("gog-avatar").src = data.avatars.menu_user_av_big2;
            document.getElementById("gog-name").innerText = data.username;
            document.getElementById("gog-name").href = `https://www.gog.com/u/${data.username}/wishlist`;
            document.getElementById("details-gog").style.display = "block";
        });
    
}

document.getElementById("btn-gog-login").addEventListener("click", () => {
    chrome.runtime.sendMessage({
        "type": "startGogLogin"
    });
});

document.getElementById("btn-steam-login").addEventListener("click", () => {
    chrome.runtime.sendMessage({
        "type": "startSteamLogin"
    });
});

document.getElementById("btn-import-wishlist").addEventListener("click", () => {
    chrome.storage.local.get(["gog_access_token", "steam_user_id"], (result) => {
        if (!result.gog_access_token) {
            alert("Please connect to your GOG.com account.", 5000);
        }
        
        if (!result.steam_user_id) {
            alert("Please connect to your Steam account.", 5000);
        }

        if (result.gog_access_token && result.steam_user_id) {
            document.getElementById("icon-rotate").classList.add("icon-spin");

            chrome.runtime.sendMessage({
                "type": "importWishlist",
                "removeAll": document.getElementById("delete-all-wishlist").checked
            });
        }
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case "gogAccessTokenRefreshed":
            setGogDetails(message.gogAccessToken);
            break;
        case "steamLoggedIn":
            setSteamDetails(message.steam_user_id);
            break;
        case "wishlistImported":
            document.getElementById("delete-all-wishlist").checked = false;
            document.getElementById("icon-rotate").classList.remove("icon-spin");
            alert(`Games added : ${message.results.added}\n Games not found : ${message.results.notFound}\n Games already in wishlist : ${message.results.alreadyInWishlist}`, 10000);
            break;
    }
});

function checkIfAlreadyAuthenticate() {
    chrome.storage.local.get(["gog_access_token", "steam_user_id"], (result) => {
        if (result.gog_access_token) {
            chrome.runtime.sendMessage({
                "type": "refreshGogAccessToken"
            });
        }

        if (result.steam_user_id) {
            setSteamDetails(result.steam_user_id);
        }
    });
}

checkIfAlreadyAuthenticate();
