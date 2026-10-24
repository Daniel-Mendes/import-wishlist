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

    const alertEl = document.getElementById("alert");
    alertEl.classList.remove("success", "error");

    alertEl.innerText = message;
    alertEl.classList.add(status);
    alertEl.style.display = "block";
   
    alertTimeoutId = setTimeout(() => {
        alertEl.style.display = "none";
        alertEl.classList.remove(status);
    }, timeout);
}

function setSteamDetails() {
    chrome.runtime.sendMessage({ type: "getSteamProfile" }, (profile) => {
        if (profile) {
            document.getElementById("title-steam").textContent = chrome.i18n.getMessage("titleSteamAccount") || "Your Steam account";
            document.getElementById("btn-steam-login").style.display = "none";
            if (profile.avatarUrl) {
                document.getElementById("steam-avatar").src = profile.avatarUrl;
            }
            document.getElementById("steam-name").href = profile.profileUrl;
            document.getElementById("steam-name").textContent = profile.steamName;
            document.getElementById("details-steam").style.display = "block";
        }
    });

    chrome.runtime.sendMessage({ type: "getSteamWishlist" }, (response) => {
        if (response) {
            document.getElementById("steam-wishlist-count").getElementsByTagName("span")[0].textContent = response.steamWishlistCount;
            document.getElementsByClassName("container-wishlist")[0].style.display = "block";

            if (response.isPrivate) {
                alert("error", "Your Steam wishlist is Private! Go to Steam -> Edit Profile -> Privacy Settings and set 'Game details' to Public.", 9000);
            }
        }
    });
}

function setGogDetails(gogAccessToken) {
    fetch("https://menu.gog.com/v1/account/basic", {
        "headers": {
            "Authorization": `Bearer ${gogAccessToken}`,
        }
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById("title-gog").textContent = chrome.i18n.getMessage("titleGogAccount") || "Your GOG account";
        document.getElementById("btn-gog-login").style.display = "none";
        if (data.avatars && data.avatars.menu_user_av_big2) {
            document.getElementById("gog-avatar").src = data.avatars.menu_user_av_big2;
        }
        document.getElementById("gog-name").textContent = data.username;
        document.getElementById("gog-name").href = `https://www.gog.com/u/${data.username}/wishlist`;
        document.getElementById("details-gog").style.display = "block";
    });

    chrome.runtime.sendMessage({
        "type": "getGogWishlist",
    }, (response) => {
        if (response && response.gogWishlistCount !== undefined) {
            document.getElementById("gog-wishlist-count").getElementsByTagName("span")[0].textContent = response.gogWishlistCount;
            document.getElementsByClassName("container-wishlist")[1].style.display = "block";
        }
    });
}

document.getElementById("btn-gog-login").addEventListener("click", () => {
    chrome.runtime.sendMessage({ "type": "startGogLogin" });
});

document.getElementById("btn-steam-login").addEventListener("click", () => {
    chrome.runtime.sendMessage({ "type": "startSteamLogin" });
});

document.getElementById("btn-import-wishlist").addEventListener("click", () => {
    chrome.storage.local.get(["gog_access_token", "steam_user_id"], (result) => {
        if (!result.gog_access_token) {
            alert("error", chrome.i18n.getMessage("alertGogNotSignIn"), 5000);
            return;
        }
        
        if (!result.steam_user_id) {
            alert("error", chrome.i18n.getMessage("alertSteamNotSignIn"), 5000);
            return;
        }
        
        document.getElementById("icon-rotate").classList.add("icon-spin");

        chrome.runtime.sendMessage({
            "type": "importWishlist",
        });
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case "gogLoginSuccess":
            alert("success", chrome.i18n.getMessage("alertGogSignIn") || "GOG signed in!", 5000);
            setGogDetails(message.gogAccessToken);
            break;
        case "gogAccessTokenRefreshed":
            setGogDetails(message.gogAccessToken);
            break;
        case "steamLoggedIn":
            setSteamDetails();
            break;
        case "wishlistImportFailed":
            document.getElementById("icon-rotate").classList.remove("icon-spin");
            break;
        case "wishlistImported":
            document.getElementById("icon-rotate").classList.remove("icon-spin");
            alert("success",
                `${chrome.i18n.getMessage("alertWishlistImportedGamesAdded")} : ${message.results.added}
                 ${chrome.i18n.getMessage("alertWishlistImportedGamesNotFound")} : ${message.results.notFound}
                 ${chrome.i18n.getMessage("alertWishlistImportedGamesAlreadyInWishlist")} : ${message.results.alreadyInWishlist}`,
                10000);
            break;
        case "alert":
            alert(message.status, message.message, message.timeout);
            break;
    }
});

function checkIfAlreadyAuthenticate() {
    chrome.storage.local.get(["gog_access_token", "steam_user_id"], (result) => {
        if (result.gog_access_token) {
            chrome.runtime.sendMessage({ "type": "refreshGogAccessToken" });
        }

        if (result.steam_user_id) {
            setSteamDetails();
        }
    });
}

checkIfAlreadyAuthenticate();