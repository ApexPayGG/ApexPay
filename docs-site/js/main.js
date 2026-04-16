/**
 * ApexPay Docs — navigation, copy buttons, syntax highlighting
 */
(function () {
  "use strict";

  var MENU_OPEN_CLASS = "is-open";

  function getSidebar() {
    return document.getElementById("sidebar");
  }

  function getOverlay() {
    return document.getElementById("sidebar-overlay");
  }

  function closeSidebar() {
    var s = getSidebar();
    var o = getOverlay();
    if (s) {
      s.classList.remove(MENU_OPEN_CLASS);
    }
    if (o) {
      o.classList.remove(MENU_OPEN_CLASS);
    }
    document.body.style.overflow = "";
  }

  function openSidebar() {
    var s = getSidebar();
    var o = getOverlay();
    if (s) {
      s.classList.add(MENU_OPEN_CLASS);
    }
    if (o) {
      o.classList.add(MENU_OPEN_CLASS);
    }
    document.body.style.overflow = "hidden";
  }

  function toggleSidebar() {
    var s = getSidebar();
    if (s && s.classList.contains(MENU_OPEN_CLASS)) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  function initMobileNav() {
    var toggle = document.getElementById("menu-toggle");
    var overlay = getOverlay();
    if (toggle) {
      toggle.addEventListener("click", function () {
        toggleSidebar();
      });
    }
    if (overlay) {
      overlay.addEventListener("click", closeSidebar);
    }
    window.addEventListener(
      "resize",
      function () {
        if (window.innerWidth > 960) {
          closeSidebar();
        }
      },
      { passive: true },
    );
  }

  function setActiveNav() {
    var page = document.body.getAttribute("data-page");
    if (!page) {
      return;
    }
    var links = document.querySelectorAll(".sidebar__nav a[data-nav]");
    links.forEach(function (a) {
      if (a.getAttribute("data-nav") === page) {
        a.classList.add("is-active");
        a.setAttribute("aria-current", "page");
      }
    });
  }

  function initCopyButtons() {
    var blocks = document.querySelectorAll(".code-block");
    blocks.forEach(function (wrap) {
      var btn = wrap.querySelector(".copy-btn");
      var pre = wrap.querySelector("pre");
      if (!btn || !pre) {
        return;
      }
      btn.addEventListener("click", function () {
        var text = pre.innerText || pre.textContent || "";
        function done() {
          btn.classList.add("is-done");
          var prev = btn.textContent;
          btn.textContent = "Skopiowano";
          window.setTimeout(function () {
            btn.classList.remove("is-done");
            btn.textContent = prev;
          }, 2000);
        }
        function fail() {
          btn.textContent = "Ctrl+C";
          window.setTimeout(function () {
            btn.textContent = "Kopiuj";
          }, 2000);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(fail);
        } else {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            done();
          } catch (e) {
            fail();
          }
          document.body.removeChild(ta);
        }
      });
    });
  }

  function runHighlight() {
    if (typeof window.hljs === "undefined" || !window.hljs.highlightElement) {
      return;
    }
    document.querySelectorAll("pre code").forEach(function (block) {
      if (!block.className.includes("language-")) {
        block.classList.add("language-plaintext");
      }
      try {
        window.hljs.highlightElement(block);
      } catch (e) {
        /* ignore */
      }
    });
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    setActiveNav();
    initMobileNav();
    runHighlight();
    initCopyButtons();
  });
})();
