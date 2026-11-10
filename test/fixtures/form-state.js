// Simulates React-controlled forms: values live in __formState and every input is re-rendered from it,
// so a plain `.value = x` (no input event) is wiped by the next render and never reaches the state.
(() => {
  const state = (window.__formState = {});
  const keyOf = (el) => el.name || el.getAttribute("data-automation-id") || el.id;
  const isText = (el) => el.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([data-multiselect]), textarea, select");

  function render() {
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (!isText(el) || el.type === "hidden") continue;
      const wanted = state[keyOf(el)] ?? "";
      if (el.value !== wanted) el.value = wanted;
    }
    window.__invalid = [...document.querySelectorAll("[required]")].filter((el) => isText(el) && !state[keyOf(el)]).map(keyOf);
  }

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (el instanceof Element && isText(el)) {
      state[keyOf(el)] = el.value;
      render();
    }
  });
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.type === "radio" && el.checked) state[el.name] = el.value;
    if (el.type === "checkbox") state[keyOf(el)] = el.checked;
    if (el.type === "file") state[keyOf(el)] = [...el.files].map((file) => file.name).join(",");
  });

  // Workday-style listbox buttons: popup is rendered in a portal after a short async delay.
  function openDropdown(button) {
    closeDropdowns();
    const options = button.dataset.options.split("|");
    const hasSearch = button.hasAttribute("data-search");
    setTimeout(() => {
      if (document.querySelector("[data-popup]")) return;
      const popup = document.createElement("div");
      popup.setAttribute("data-popup", "");
      popup.innerHTML = (hasSearch ? '<input data-automation-id="searchBox" placeholder="Search" />' : "") + '<div role="listbox"></div>';
      const list = popup.querySelector("[role=listbox]");
      const paint = (query) => {
        const shown = options.filter((text) => (query ? text.toLowerCase().includes(query.toLowerCase()) : !hasSearch || options.indexOf(text) < 4));
        list.innerHTML = "";
        for (const text of shown) {
          const option = document.createElement("div");
          option.setAttribute("role", "option");
          option.setAttribute("data-automation-id", "promptOption");
          option.textContent = text;
          option.addEventListener("click", () => {
            button.textContent = text;
            state[button.getAttribute("data-automation-id")] = text;
            closeDropdowns();
            render();
          });
          list.append(option);
        }
      };
      paint("");
      popup.querySelector("input")?.addEventListener("input", (event) => paint(event.target.value));
      document.body.append(popup);
    }, 120);
  }
  function closeDropdowns() {
    document.querySelectorAll("[data-popup]").forEach((popup) => popup.remove());
  }
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element && event.target.closest("button[aria-haspopup=listbox]");
    if (button) openDropdown(button);
  });
  document.addEventListener("keydown", (event) => event.key === "Escape" && closeDropdowns());

  // Workday-style custom radio group (role=radiogroup > role=radio buttons)
  document.addEventListener("click", (event) => {
    const radio = event.target instanceof Element && event.target.closest("[role=radio]");
    if (!radio) return;
    const group = radio.closest("[role=radiogroup]");
    group.querySelectorAll("[role=radio]").forEach((other) => other.setAttribute("aria-checked", String(other === radio)));
    state[group.getAttribute("data-automation-id")] = radio.textContent.trim();
  });

  // Workday multiselect: typing alone shows nothing, Enter runs the search; a pick becomes a pill and clears the input.
  document.addEventListener("keydown", (event) => {
    const box = event.target instanceof Element && event.target.closest("input[data-multiselect]");
    if (!box || event.key !== "Enter") return;
    closeDropdowns();
    const popup = document.createElement("div");
    popup.setAttribute("data-popup", "");
    popup.innerHTML = '<div role="listbox"></div>';
    for (const text of box.dataset.multiselect.split("|").filter((text) => text.toLowerCase().includes(box.value.toLowerCase()))) {
      const option = document.createElement("div");
      option.setAttribute("role", "option");
      option.setAttribute("data-automation-id", "promptOption");
      option.textContent = text;
      option.addEventListener("click", () => {
        state[box.name] = text;
        box.value = "";
        box.insertAdjacentHTML("beforebegin", `<span data-automation-id="selectedItem">${text}</span>`);
        closeDropdowns();
      });
      popup.firstChild.append(option);
    }
    document.body.append(popup);
  });

  document.addEventListener("DOMContentLoaded", render);
})();
