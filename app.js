/* ============================================================
   My House — app logic
   Two modes:
     • View mode  — the picture board used by the person with aphasia
     • Setup mode — PIN-protected screens for the carer
   ============================================================ */

"use strict";

const app = document.getElementById("app");
const overlayRoot = document.getElementById("overlay-root");

/* Whether the carer has entered the PIN this session */
let setupUnlocked = false;

/* Captured install prompt — set when Chrome is ready to install the PWA */
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
});

/* ---------- tiny DOM helper ---------- */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "onclick") node.addEventListener("click", v);
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

/* Object URLs for photos. Screens are built first and shown with setScreen()
   afterwards, so URLs made during the build go into pendingUrls and must only
   be revoked once the FOLLOWING screen replaces them — revoking them inside
   the same setScreen call would kill the images before they load. */
let currentUrls = []; // used by the screen on display
let pendingUrls = []; // created while building the next screen
function photoUrl(blob) {
  const url = URL.createObjectURL(blob);
  pendingUrls.push(url);
  return url;
}

function setScreen(...nodes) {
  app.replaceChildren(...nodes);
  currentUrls.forEach(u => URL.revokeObjectURL(u));
  currentUrls = pendingUrls;
  pendingUrls = [];
  window.scrollTo(0, 0);
}

/* ---------- speech ---------- */

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = 0.85; // slightly slower than default — clearer for the listener
    speechSynthesis.speak(u);
  } catch (e) { /* speech is a bonus, never break the app over it */ }
}

/* ---------- photo handling ---------- */

const MAX_PHOTO_SIZE = 1280; // px — keeps storage small, plenty sharp on a tablet

async function compressPhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (e) {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close && bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Could not read that photo")),
      "image/jpeg", 0.82
    );
  });
}

/* ---------- confirm dialog (custom: big buttons, spoken-free, no browser UI) ---------- */

function confirmDialog(message, confirmLabel) {
  return new Promise(resolve => {
    function close(answer) {
      overlayRoot.replaceChildren();
      resolve(answer);
    }
    const dialog = el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", "aria-label": message },
      el("p", {}, message),
      el("div", { class: "form-buttons" },
        el("button", { class: "btn btn-plain", onclick: () => close(false) }, "Cancel"),
        el("button", { class: "btn btn-red", onclick: () => close(true) }, confirmLabel),
      )
    );
    overlayRoot.replaceChildren(el("div", { class: "overlay" }, dialog));
    dialog.querySelector("button").focus();
  });
}

/* ============================================================
   VIEW MODE — used by the person with aphasia
   ============================================================ */

async function showHome() {
  setupUnlocked = false; // returning home always re-locks setup
  const rooms = await DB.getRooms();

  const grid = el("div", { class: "grid" });
  for (const room of rooms) {
    grid.append(
      el("button", {
          class: "card",
          "aria-label": room.name,
          onclick: () => { speak(room.name); showRoom(room.id); },
        },
        el("img", { src: photoUrl(room.photo), alt: "" }),
        el("span", { class: "card-label" }, room.name),
      )
    );
  }

  const children = [
    el("div", { class: "topbar" }, el("h1", {}, "My House")),
  ];

  if (rooms.length === 0) {
    children.push(el("div", { class: "notice" },
      "No rooms yet.", el("br"), "A carer can add rooms in Carer Setup below."));
  } else {
    children.push(grid);
  }

  if (deferredInstallPrompt) {
    children.push(
      el("div", { class: "install-banner" },
        el("button", {
          class: "btn btn-primary btn-wide",
          onclick: async () => {
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            showHome();
          },
        }, "Install app on this device")
      )
    );
  }

  children.push(
    el("div", { class: "setup-entry" },
      el("button", { class: "btn-setup", onclick: openSetup }, "Carer Setup"))
  );

  setScreen(...children);
}

async function showRoom(roomId) {
  const room = await DB.getRoom(roomId);
  if (!room) return showHome();
  const items = await DB.getItems(roomId);

  const grid = el("div", { class: "grid" });
  for (const item of items) {
    grid.append(
      el("button", {
          class: "card",
          "aria-label": item.name,
          onclick: () => { speak(item.name); showItem(room, item); },
        },
        el("img", { src: photoUrl(item.photo), alt: "" }),
        el("span", { class: "card-label" }, item.name),
      )
    );
  }

  setScreen(
    el("div", { class: "topbar" },
      el("button", { class: "btn-back", onclick: showHome },
        el("span", { class: "arrow", "aria-hidden": "true" }, "◀"), "Home"),
      el("h1", { onclick: () => speak(room.name) }, room.name),
    ),
    items.length === 0
      ? el("div", { class: "notice" }, "Nothing in this room yet.")
      : grid,
  );
}

/* Full-screen view of one item — big photo + big word, to show a carer */
function showItem(room, item) {
  setScreen(
    el("div", { class: "topbar" },
      el("button", { class: "btn-back", onclick: () => showRoom(room.id) },
        el("span", { class: "arrow", "aria-hidden": "true" }, "◀"), room.name),
    ),
    el("div", { class: "bigview" },
      el("button", { class: "bigphoto", "aria-label": "Say " + item.name, onclick: () => speak(item.name) },
        el("img", { src: photoUrl(item.photo), alt: item.name })),
      el("div", { class: "bigword" }, item.name),
      el("button", { class: "btn-say", onclick: () => speak(item.name) },
        el("span", { "aria-hidden": "true" }, "🔊"), "Say it"),
    ),
  );
}

/* ============================================================
   PIN GATE
   ============================================================ */

async function openSetup() {
  if (setupUnlocked) return showEditHome();
  const savedPin = await DB.getSetting("pin");
  if (!savedPin) {
    showPinSetup();
    return;
  }
  function attempt(message) {
    showPinPad("Enter carer PIN", message, pin => {
      if (pin === savedPin) {
        setupUnlocked = true;
        showEditHome();
      } else {
        attempt("Wrong PIN — try again");
      }
    });
  }
  attempt("");
}

function showPinSetup(message) {
  showPinPad("Choose a 4-digit carer PIN", message || "You will use this to open setup", firstPin => {
    showPinPad("Enter the same PIN again", "", async pin => {
      if (pin === firstPin) {
        await DB.setSetting("pin", pin);
        // Ask the browser to protect our storage from automatic clean-up
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(() => {});
        }
        setupUnlocked = true;
        showEditHome();
      } else {
        showPinSetup("The PINs did not match — please start again");
      }
    });
  });
}

function showPinPad(title, subtitle, onComplete) {
  let entered = "";

  const dots = el("div", { class: "pin-dots", "aria-live": "polite" });
  const isError = subtitle && (subtitle.includes("Wrong") || subtitle.includes("did not match"));
  const sub = el("p", { class: "pin-sub" + (isError ? " pin-error" : ""), "aria-live": "assertive" }, subtitle || "");

  function refresh() {
    dots.textContent = "●".repeat(entered.length) + "○".repeat(4 - entered.length);
  }

  async function press(digit) {
    if (entered.length >= 4) return;
    entered += digit;
    refresh();
    if (entered.length === 4) {
      const pin = entered;
      entered = "";
      await onComplete(pin);
    }
  }

  const pad = el("div", { class: "pin-pad" });
  for (const d of ["1","2","3","4","5","6","7","8","9"]) {
    pad.append(el("button", { class: "pin-key", onclick: () => press(d) }, d));
  }
  pad.append(
    el("button", { class: "pin-key", "aria-label": "Delete last digit",
        onclick: () => { entered = entered.slice(0, -1); refresh(); } }, "⌫"),
    el("button", { class: "pin-key", onclick: () => press("0") }, "0"),
    el("button", { class: "pin-key", "aria-label": "Cancel and go back", onclick: showHome }, "✕"),
  );

  refresh();
  setScreen(
    el("div", { class: "pin-wrap" },
      el("div", { class: "pin-title" }, title),
      sub,
      dots,
      pad,
    )
  );
}

/* ============================================================
   SETUP MODE — for the carer
   ============================================================ */

async function showEditHome() {
  const rooms = await DB.getRooms();

  const list = el("div", {});
  rooms.forEach((room, i) => {
    list.append(el("div", { class: "edit-row" },
      el("img", { src: photoUrl(room.photo), alt: "" }),
      el("span", { class: "row-name" }, room.name),
      el("div", { class: "row-actions" },
        el("button", { class: "btn-small go", onclick: () => showEditRoom(room.id) }, "Items ▸"),
        el("button", { class: "btn-small", onclick: () => showRoomForm(room) }, "Edit"),
        el("button", { class: "btn-small", "aria-label": "Move " + room.name + " up",
            onclick: () => moveEntry(rooms, i, -1, r => DB.putRoom(r), showEditHome) }, "▲"),
        el("button", { class: "btn-small", "aria-label": "Move " + room.name + " down",
            onclick: () => moveEntry(rooms, i, +1, r => DB.putRoom(r), showEditHome) }, "▼"),
        el("button", { class: "btn-small danger", onclick: async () => {
            if (await confirmDialog(`Delete "${room.name}" and everything in it?`, "Delete")) {
              await DB.deleteRoom(room.id);
              showEditHome();
            }
          } }, "Delete"),
      ),
    ));
  });

  setScreen(
    el("div", { class: "topbar" },
      el("h1", {}, "Carer Setup"),
      el("button", { class: "btn btn-green", onclick: showHome }, "✓ Done"),
    ),
    el("div", { class: "setup-section" }, "Rooms"),
    rooms.length === 0
      ? el("div", { class: "notice" }, "No rooms yet — add the first one below. A wide photo of the room works best.")
      : list,
    el("button", { class: "btn btn-primary btn-wide", onclick: () => showRoomForm(null) }, "＋ Add a room"),
  );
}

async function showEditRoom(roomId) {
  const room = await DB.getRoom(roomId);
  if (!room) return showEditHome();
  const items = await DB.getItems(roomId);

  const list = el("div", {});
  items.forEach((item, i) => {
    list.append(el("div", { class: "edit-row" },
      el("img", { src: photoUrl(item.photo), alt: "" }),
      el("span", { class: "row-name" }, item.name),
      el("div", { class: "row-actions" },
        el("button", { class: "btn-small", onclick: () => showItemForm(room, item) }, "Edit"),
        el("button", { class: "btn-small", "aria-label": "Move " + item.name + " up",
            onclick: () => moveEntry(items, i, -1, it => DB.putItem(it), () => showEditRoom(roomId)) }, "▲"),
        el("button", { class: "btn-small", "aria-label": "Move " + item.name + " down",
            onclick: () => moveEntry(items, i, +1, it => DB.putItem(it), () => showEditRoom(roomId)) }, "▼"),
        el("button", { class: "btn-small danger", onclick: async () => {
            if (await confirmDialog(`Delete "${item.name}"?`, "Delete")) {
              await DB.deleteItem(item.id);
              showEditRoom(roomId);
            }
          } }, "Delete"),
      ),
    ));
  });

  setScreen(
    el("div", { class: "topbar" },
      el("button", { class: "btn-back", onclick: showEditHome },
        el("span", { class: "arrow", "aria-hidden": "true" }, "◀"), "Setup"),
      el("h1", {}, room.name),
    ),
    el("div", { class: "setup-section" }, "Items in this room"),
    items.length === 0
      ? el("div", { class: "notice" }, "No items yet — add the first one below. A close-up photo of each item works best.")
      : list,
    el("button", { class: "btn btn-primary btn-wide", onclick: () => showItemForm(room, null) }, "＋ Add an item"),
  );
}

async function moveEntry(sorted, index, direction, save, refresh) {
  const j = index + direction;
  if (j < 0 || j >= sorted.length) return;
  const a = sorted[index], b = sorted[j];
  const tmp = a.order; a.order = b.order; b.order = tmp;
  await save(a);
  await save(b);
  refresh();
}

/* ---------- add / edit forms ---------- */

function showRoomForm(existing) {
  showEntryForm({
    heading: existing ? "Edit room" : "Add a room",
    nameLabel: "Room name (e.g. Kitchen)",
    existing,
    onCancel: showEditHome,
    onSave: async (name, photoBlob) => {
      if (existing) {
        existing.name = name;
        if (photoBlob) existing.photo = photoBlob;
        await DB.putRoom(existing);
      } else {
        const rooms = await DB.getRooms();
        const maxOrder = rooms.reduce((m, r) => Math.max(m, r.order || 0), 0);
        await DB.putRoom({ id: DB.newId(), name, photo: photoBlob, order: maxOrder + 1 });
      }
      showEditHome();
    },
  });
}

function showItemForm(room, existing) {
  showEntryForm({
    heading: existing ? "Edit item" : "Add an item to " + room.name,
    nameLabel: "Item name (e.g. Kettle)",
    existing,
    onCancel: () => showEditRoom(room.id),
    onSave: async (name, photoBlob) => {
      if (existing) {
        existing.name = name;
        if (photoBlob) existing.photo = photoBlob;
        await DB.putItem(existing);
      } else {
        const items = await DB.getItems(room.id);
        const maxOrder = items.reduce((m, it) => Math.max(m, it.order || 0), 0);
        await DB.putItem({ id: DB.newId(), roomId: room.id, name, photo: photoBlob, order: maxOrder + 1 });
      }
      showEditRoom(room.id);
    },
  });
}

function showEntryForm({ heading, nameLabel, existing, onCancel, onSave }) {
  let photoBlob = null; // newly chosen photo, if any

  const nameInput = el("input", {
    type: "text",
    value: existing ? existing.name : "",
    autocapitalize: "sentences",
    maxlength: "40",
    id: "entry-name",
  });

  const preview = el("img", {
    alt: "Chosen photo",
    src: existing ? photoUrl(existing.photo) : "",
    style: existing ? "" : "display:none",
  });

  const errorMsg = el("p", { class: "form-error", "aria-live": "assertive" }, "");

  const fileInput = el("input", { type: "file", accept: "image/*", id: "entry-photo" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    errorMsg.textContent = "";
    try {
      photoBlob = await compressPhoto(file);
      preview.src = photoUrl(photoBlob);
      preview.style.display = "";
    } catch (e) {
      errorMsg.textContent = "Sorry, that photo could not be read. Please try another.";
    }
  });

  const saveBtn = el("button", { class: "btn btn-green", onclick: async () => {
    const name = nameInput.value.trim();
    if (!name) { errorMsg.textContent = "Please type a name."; nameInput.focus(); return; }
    if (!existing && !photoBlob) { errorMsg.textContent = "Please choose a photo."; return; }
    saveBtn.disabled = true;
    try {
      await onSave(name, photoBlob);
    } catch (e) {
      saveBtn.disabled = false;
      errorMsg.textContent = "Saving failed — the device may be out of storage space.";
    }
  } }, "✓ Save");

  setScreen(
    el("div", { class: "topbar" }, el("h1", {}, heading)),
    el("div", { class: "form" },
      el("div", {},
        el("label", { for: "entry-name" }, nameLabel),
        nameInput,
      ),
      el("div", { class: "photo-picker" },
        preview,
        fileInput,
        el("label", { for: "entry-photo", class: "btn btn-primary btn-wide", role: "button", tabindex: "0" },
          existing ? "📷 Change photo" : "📷 Take or choose a photo"),
      ),
      errorMsg,
      el("div", { class: "form-buttons" },
        el("button", { class: "btn btn-plain", onclick: onCancel }, "Cancel"),
        saveBtn,
      ),
    ),
  );
  if (!existing) nameInput.focus();
}

/* ============================================================
   start
   ============================================================ */

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

showHome();
