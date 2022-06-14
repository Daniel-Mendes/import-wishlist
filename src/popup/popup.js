function setGogLoginSizes() {
    const gogLoginWidth = 393;
    const gogLoginHeight = 500;
    const gogLoginleft = Math.floor((screen.width / 2) - (gogLoginWidth / 2));
    const gogLoginTop = Math.floor((screen.height / 2) - (gogLoginHeight / 2));

    const gogLoginSizes = {
        "width": gogLoginWidth,
        "height": gogLoginHeight,
        "left": gogLoginleft,
        "top": gogLoginTop
    };
    chrome.runtime.sendMessage({
        "type": "setGogLoginSizes",
        "gogLoginSizes": gogLoginSizes
    });
}

setGogLoginSizes();

let alertTimeoutId;

function alert(status, message, timeout) {
    clearTimeout(alertTimeoutId);

    const alert = document.getElementById("alert");
    alert.classList.remove("success", "error");

    alert.innerText = message;
    alert.classList.add(status);
    alert.style.display = "block";
   
    alertTimeoutId = setTimeout(() => {
        alert.style.display = "none";
        alert.classList.remove(status);
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

    chrome.runtime.sendMessage({
        "type": "getSteamWishlist",
    }, (response) => {
        document.getElementById("steam-wishlist-count").getElementsByTagName("span")[0].innerText = response.steamWishlistCount;
        document.getElementsByClassName("container-wishlist")[0].style.display = "block";
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

    chrome.runtime.sendMessage({
        "type": "getGogWishlist",
    }, (response) => {
        document.getElementById("gog-wishlist-count").getElementsByTagName("span")[0].innerText = response.gogWishlistCount;
        document.getElementsByClassName("container-wishlist")[1].style.display = "block";
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
            alert("error", "Please connect to your GOG.com account.", 5000);
        }
        
        if (!result.steam_user_id) {
            alert("error", "Please connect to your Steam account.", 5000);
        }

        if (result.gog_access_token && result.steam_user_id) {
            document.getElementById("icon-rotate").classList.add("icon-spin");

            chrome.runtime.sendMessage({
                "type": "importWishlist",
            });
        }
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case "gogAccessTokenSuccess":
            alert("success", "GOG.com account connected successfully.", 5000);
            chrome.tabs.remove(sender.tab.id);
            setGogDetails(message.gogAccessToken);
            break;
        case "gogAccessTokenRefreshed":
            setGogDetails(message.gogAccessToken);
            break;
        case "steamLoggedIn":
            setSteamDetails(message.steam_user_id);
            break;
        case "wishlistImported":
            document.getElementById("icon-rotate").classList.remove("icon-spin");
            alert("success", `Games added : ${message.results.added}\n Games not found : ${message.results.notFound}\n Games already in wishlist : ${message.results.alreadyInWishlist}`, 10000);
            break;
        case "alert":
            alert(message.status, message.message, message.timeout);
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
