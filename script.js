const root = document.documentElement;
const themeToggle = document.querySelector("[data-theme-toggle]");
const savedTheme = localStorage.getItem("theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
  root.dataset.theme = "dark";
}

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = nextTheme;
  localStorage.setItem("theme", nextTheme);
});

const header = document.querySelector("[data-header]");
const updateHeader = () => header?.classList.toggle("scrolled", window.scrollY > 20);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const menuToggle = document.querySelector("[data-menu-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");

const closeMenu = () => {
  menuToggle?.setAttribute("aria-expanded", "false");
  mobileNav?.classList.remove("open");
};

menuToggle?.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  mobileNav?.classList.toggle("open", !isOpen);
});

mobileNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll(".reveal");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealItems.forEach((item) => observer.observe(item));
}

document.querySelector("[data-year]").textContent = new Date().getFullYear();
