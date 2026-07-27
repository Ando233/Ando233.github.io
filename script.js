const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
let savedTheme = null;

try {
  savedTheme = localStorage.getItem("theme");
} catch {}

const applyTheme = (theme) => {
  if (theme === "dark") {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }

  const isDark = theme === "dark";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", isDark ? "#111412" : "#f3f4f0");
  themeToggle?.setAttribute("aria-pressed", String(isDark));
  themeToggle?.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
};

applyTheme(savedTheme || (systemDark.matches ? "dark" : "light"));

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("theme", nextTheme);
  } catch {}
  applyTheme(nextTheme);
});

systemDark.addEventListener("change", (event) => {
  let hasSavedTheme = false;
  try {
    hasSavedTheme = Boolean(localStorage.getItem("theme"));
  } catch {}
  if (!hasSavedTheme) {
    applyTheme(event.matches ? "dark" : "light");
  }
});

const header = document.querySelector("[data-header]");
const headerSentinel = document.querySelector("[data-header-sentinel]");

if (header && headerSentinel && "IntersectionObserver" in window) {
  const headerObserver = new IntersectionObserver(
    ([entry]) => header.classList.toggle("scrolled", !entry.isIntersecting),
    { threshold: 0 }
  );
  headerObserver.observe(headerSentinel);
} else {
  header?.classList.add("scrolled");
}

const menuToggle = document.querySelector("[data-menu-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");

const closeMenu = () => {
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open navigation");
  mobileNav?.classList.remove("open");
  document.body.classList.remove("menu-open");
};

menuToggle?.addEventListener("click", () => {
  const nextOpen = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(nextOpen));
  menuToggle.setAttribute("aria-label", nextOpen ? "Close navigation" : "Open navigation");
  mobileNav?.classList.toggle("open", nextOpen);
  document.body.classList.toggle("menu-open", nextOpen);

  if (nextOpen) {
    mobileNav?.querySelector("a")?.focus();
  }
});

mobileNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menuToggle?.focus();
  }
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let revealObserver = null;

if (!reduceMotion && "IntersectionObserver" in window) {
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
}

window.initializeReveals = (items = document.querySelectorAll(".reveal")) => {
  items.forEach((item) => {
    if (!revealObserver) {
      item.classList.add("visible");
    } else {
      revealObserver.observe(item);
    }
  });
};

window.initializeReveals();

const year = document.querySelector("[data-year]");
if (year) year.textContent = new Date().getFullYear();
