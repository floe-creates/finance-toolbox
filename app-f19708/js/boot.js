/* sets light or dark before the page draws, so it doesn't flash */
try { if (localStorage.getItem("ft.theme") === "light") document.documentElement.dataset.theme = "light"; } catch (e) {}
