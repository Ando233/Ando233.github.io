const lifeStream = document.querySelector("[data-life-stream]");
const lifePosts = Array.isArray(window.LIFE_POSTS) ? window.LIFE_POSTS : [];
const lightbox = document.querySelector("[data-life-lightbox]");
const lightboxImage = document.querySelector("[data-life-lightbox-image]");
const lightboxCount = document.querySelector("[data-life-lightbox-count]");
const lightboxClose = document.querySelector("[data-life-lightbox-close]");
const lightboxPrevious = document.querySelector("[data-life-lightbox-prev]");
const lightboxNext = document.querySelector("[data-life-lightbox-next]");
const allLifeImages = [];
let activeImageIndex = 0;

const makeElement = (tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const showLifeState = (message, state = "empty") => {
  if (!lifeStream) return;
  const wrapper = makeElement("div", `life-state life-state-${state}`);
  wrapper.append(makeElement("p", "", message));
  lifeStream.replaceChildren(wrapper);
};

const updateLightbox = () => {
  const image = allLifeImages[activeImageIndex];
  if (!image || !lightboxImage || !lightboxCount) return;

  lightboxImage.src = image.src;
  lightboxImage.alt = image.alt;
  lightboxCount.textContent = `${activeImageIndex + 1} / ${allLifeImages.length}`;

  const hasMultipleImages = allLifeImages.length > 1;
  if (lightboxPrevious) lightboxPrevious.hidden = !hasMultipleImages;
  if (lightboxNext) lightboxNext.hidden = !hasMultipleImages;
};

const openLightbox = (index) => {
  if (!lightbox || typeof lightbox.showModal !== "function") return false;
  activeImageIndex = index;
  updateLightbox();
  lightbox.showModal();
  return true;
};

const moveLightbox = (step) => {
  if (!allLifeImages.length) return;
  activeImageIndex = (activeImageIndex + step + allLifeImages.length) % allLifeImages.length;
  updateLightbox();
};

const renderLife = () => {
  if (!lifeStream) return;
  if (!lifePosts.length) {
    showLifeState("这里还没有动态。第一段文字或第一张照片，会从这里开始。");
    return;
  }

  const fragment = document.createDocumentFragment();

  lifePosts.forEach((post) => {
    if (!post || (!Array.isArray(post.text) && !Array.isArray(post.images))) return;

    const article = makeElement("article", "life-entry reveal");
    if (post.id) article.id = post.id;

    const meta = makeElement("div", "life-entry-meta");
    const time = makeElement("time", "", post.displayDate || post.date || "");
    if (post.date) time.dateTime = post.date;
    meta.append(time);
    if (post.label) meta.append(makeElement("span", "", post.label));

    const body = makeElement("div", "life-entry-body");
    const copy = makeElement("div", "life-entry-copy");
    (post.text || []).forEach((paragraph) => {
      if (paragraph) copy.append(makeElement("p", "", paragraph));
    });
    if (copy.childElementCount) body.append(copy);

    const images = (post.images || []).filter((image) => image && image.src);
    if (images.length) {
      const gallery = makeElement("div", "life-gallery");
      gallery.dataset.count = String(images.length);

      images.forEach((image, imageIndex) => {
        const globalImageIndex = allLifeImages.length;
        const imageData = {
          src: image.src,
          alt: image.alt || `生活动态图片 ${imageIndex + 1}`
        };
        allLifeImages.push(imageData);

        const link = makeElement("a", "life-photo");
        link.href = image.src;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.setAttribute("aria-label", `查看第 ${imageIndex + 1} 张图片`);

        const picture = makeElement("img");
        picture.src = image.src;
        picture.alt = imageData.alt;
        picture.loading = "lazy";
        picture.decoding = "async";
        link.append(picture);

        link.addEventListener("click", (event) => {
          if (openLightbox(globalImageIndex)) event.preventDefault();
        });
        gallery.append(link);
      });

      body.append(gallery);
    }

    article.append(meta, body);
    fragment.append(article);
  });

  if (!fragment.childNodes.length) {
    showLifeState("生活动态暂时无法显示。", "error");
    return;
  }

  lifeStream.replaceChildren(fragment);

  if (window.initializeReveals) {
    window.initializeReveals(lifeStream.querySelectorAll(".reveal"));
  } else {
    lifeStream.querySelectorAll(".reveal").forEach((item) => item.classList.add("visible"));
  }
};

try {
  renderLife();
} catch {
  showLifeState("生活动态暂时无法显示，请稍后再来。", "error");
}

lightboxClose?.addEventListener("click", () => lightbox?.close());
lightboxPrevious?.addEventListener("click", () => moveLightbox(-1));
lightboxNext?.addEventListener("click", () => moveLightbox(1));

lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) lightbox.close();
});

lightbox?.addEventListener("close", () => {
  if (lightboxImage) lightboxImage.src = "";
});

document.addEventListener("keydown", (event) => {
  if (!lightbox?.open) return;
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});
