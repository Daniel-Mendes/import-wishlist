const userAgent = navigator.userAgent;
let browserName;

if (userAgent.match(/Edg\//i)) {
    browserName = "edge";
} else if (userAgent.match(/Chrome\//i)) {
    browserName = "chrome";
} else if (userAgent.match(/Firefox\//i)) {
    browserName = "firefox";
}

switch (browserName) {
    case "chrome":
        document.getElementById("btn-chrome").classList.add("btn-primary");
        document.getElementById("btn-chrome").classList.remove("btn-secondary");
        break;
    case "edge":
        document.getElementById("download").prepend(document.getElementById("download").children[1]);
        document.getElementById("btn-edge").classList.add("btn-primary");
        document.getElementById("btn-edge").classList.remove("btn-secondary");
        break;
    case "firefox":
        document.getElementById("download").prepend(document.getElementById("download").children[2]);
        document.getElementById("btn-firefox").classList.add("btn-primary");
        document.getElementById("btn-firefox").classList.remove("btn-secondary");
        break;
}
