'use strict';

const SEASONS = [
  { id: 'spring', label: 'Spring' },
  { id: 'summer', label: 'Summer' },
  { id: 'autumn', label: 'Autumn' },
  { id: 'winter', label: 'Winter' },
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' }
];
const VIEWS = ['account', 'favorites', 'collection', 'wishlist', 'seasons', 'profile'];
const LOCKED = VIEWS.filter((id) => id !== 'account');
const SEASON_MAP = { sunny: 'day', beach: 'summer' }; 
const KEYS = {
  users: 'sillage.users',
  session: 'sillage.session',
  data: (user) => `sillage.data.${user}`
};

const state = { user: null, items: [], activeSeason: 'summer', profileId: null };

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function say(id, message = '', isError = false) {
  const el = $(id);
  el.textContent = message;
  el.className = isError ? 'status err' : 'status';
}

async function withBusy(form, task) {
  const buttons = $$('button', form);
  buttons.forEach((b) => { b.disabled = true; });
  try {
    return await task();
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const splitList = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const byBrandThenName = (a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name);
const sorted = (list) => [...list].sort(byBrandThenName);

const memory = new Map();
const storage = {
  async get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  async set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  async remove(key) {
    memory.delete(key);
    try { localStorage.removeItem(key); } catch {  }
  }
};

async function saveItems() {
  if (state.user) await storage.set(KEYS.data(state.user), state.items);
}

async function loadItems() {
  const stored = state.user ? await storage.get(KEYS.data(state.user)) : null;
  state.items = Array.isArray(stored) ? stored : [];

  const valid = new Set(SEASONS.map((s) => s.id));
  let changed = false;
  for (const item of state.items) {
    const before = JSON.stringify(item.seasons ?? []);
    const next = [];
    for (const tag of item.seasons ?? []) {
      const mapped = SEASON_MAP[tag] ?? tag;
      if (valid.has(mapped) && !next.includes(mapped)) next.push(mapped);
    }
    item.seasons = next;
    if (JSON.stringify(next) !== before) changed = true;
  }
  if (changed) await saveItems();
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function randomSalt() {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toHex(bytes);
}

function fallbackHash(text) {
  let x = 5381;
  for (let i = 0; i < text.length; i++) x = ((x << 5) + x + text.charCodeAt(i)) | 0;
  return `f${(x >>> 0).toString(16)}`;
}

async function hashPassword(password, salt) {
  const text = `${salt}:${password}`;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return toHex(new Uint8Array(digest));
  } catch {
    return fallbackHash(text);
  }
}

function validateSignup(name, password) {
  const errors = { username: '', password: '' };
  if (name.length < 8) errors.username = 'Must be at least 8 characters long';
  else if (!/[a-z]/i.test(name)) errors.username = 'Username must contain at least one letter of the alphabet.';
  else if (!/^[a-z0-9_.-]+$/.test(name)) errors.username = 'Username can only use letters, numbers, dots, dashes and underscores.';

  if (/[^A-Za-z0-9]/.test(password)) errors.password = 'Special characters are not allowed';
  else if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = 'Must be at least 8 characters of numbers and letters';
  }
  return errors;
}

function showAuthErrors(errors) {
  for (const [field, inputId, errorId] of [
    ['username', 'authUser', 'authUserError'],
    ['password', 'authPass', 'authPassError']
  ]) {
    const input = $(inputId);
    const error = $(errorId);
    error.textContent = errors[field];
    error.hidden = !errors[field];
    input.setAttribute('aria-invalid', String(Boolean(errors[field])));
  }
  const firstInvalid = Object.keys(errors).find((field) => errors[field]);
  if (firstInvalid) $(`auth${firstInvalid === 'username' ? 'User' : 'Pass'}`).focus();
}

async function login(name, goTo = 'account') {
  state.user = name;
  await storage.set(KEYS.session, name);
  await loadItems();
  state.profileId = null;
  renderAll();
  location.hash = goTo;
  showView();
}

async function logout() {
  state.user = null;
  state.items = [];
  await storage.remove(KEYS.session);
  renderAll();
  location.hash = 'account';
  showView();
}

async function signUp(form, name, password) {
  const errors = validateSignup(name, password);
  showAuthErrors(errors);
  if (Object.values(errors).some(Boolean)) return;
  say('authStatus');

  const users = (await storage.get(KEYS.users)) ?? {};
  if (users[name]) return say('authStatus', 'That username is taken on this device. Sign in instead, or pick another.', true);

  const salt = randomSalt();
  users[name] = { salt, hash: await hashPassword(password, salt) };
  await storage.set(KEYS.users, users);
  form.reset();
  say('authStatus');
  return login(name, 'favorites');
}

async function signIn(form, name, password) {
  showAuthErrors({ username: '', password: '' });
  const users = (await storage.get(KEYS.users)) ?? {};
  const record = users[name];
  if (!record?.hash) return say('authStatus', 'No account with that username here. Create one with the second button.', true);

  const hash = await hashPassword(password, record.salt);
  if (hash !== record.hash) return say('authStatus', 'That password does not match. Try again.', true);

  form.reset();
  say('authStatus');
  return login(name, 'favorites');
}

function seedDemo() {
  const make = (o) => ({ id: uid(), concentration: '', size: '', seasons: [], fav: false, owned: false, wish: false, profile: {}, ...o });
  return [
    make({
      name: 'Sauvage', brand: 'Dior', concentration: 'Eau de Toilette', size: 100,
      seasons: ['day', 'summer', 'autumn'], fav: true, owned: true,
      profile: { perfumer: 'François Demachy', year: 2015, top: 'Bergamot, Pepper', heart: 'Lavender, Sichuan pepper, Patchouli', base: 'Ambroxan, Cedar, Labdanum', accords: 'Fresh spicy, Aromatic, Woody' }
    }),
    make({
      name: 'Acqua di Giò', brand: 'Giorgio Armani', concentration: 'Eau de Toilette', size: 100,
      seasons: ['day', 'summer'], fav: true, owned: true,
      profile: { perfumer: 'Alberto Morillas', year: 1996, top: 'Bergamot, Neroli, Green tangerine', heart: 'Sea notes, Jasmine, Rosemary', base: 'Cedar, Patchouli, Musk', accords: 'Aquatic, Citrus, Fresh' }
    }),
    make({
      name: 'Tobacco Vanille', brand: 'Tom Ford', concentration: 'Eau de Parfum', size: 50,
      seasons: ['autumn', 'winter', 'night'], owned: true,
      profile: { perfumer: 'Harry Frémont', year: 2007, top: 'Tobacco leaf, Spices', heart: 'Tobacco blossom, Vanilla, Cacao', base: 'Dried fruits, Wood sap', accords: 'Sweet, Tobacco, Vanilla' }
    }),
    make({
      name: 'Light Blue', brand: 'Dolce & Gabbana', concentration: 'Eau de Toilette',
      seasons: ['spring', 'day', 'summer'], fav: true,
      profile: { perfumer: 'Olivier Cresp', year: 2001, top: 'Sicilian lemon, Apple, Cedar', heart: 'Jasmine, White rose, Bamboo', base: 'Cedarwood, Amber, Musk', accords: 'Citrus, Fresh, Woody' }
    })
  ];
}

async function openDemo() {
  const users = (await storage.get(KEYS.users)) ?? {};
  if (!users.demo) {
    users.demo = { salt: '', hash: '', demo: true };
    await storage.set(KEYS.users, users);
    await storage.set(KEYS.data('demo'), seedDemo());
  }
  await login('demo', 'favorites');
}

const LIST_FLAG = { fav: 'fav', own: 'owned', wish: 'wish' };

const sameItem = (a, name, brand) =>
  a.name.toLowerCase() === name.toLowerCase() && a.brand.toLowerCase() === brand.toLowerCase();


async function addItem(kinds, data) {
  let item = state.items.find((i) => sameItem(i, data.name, data.brand));
  const merged = Boolean(item);
  if (!item) {
    item = { id: uid(), name: data.name, brand: data.brand, concentration: '', size: '', seasons: [], fav: false, owned: false, wish: false, profile: {} };
    state.items.push(item);
  }
  for (const kind of [kinds].flat()) item[LIST_FLAG[kind]] = true;
  if (data.concentration) item.concentration = data.concentration;
  if (data.size) item.size = data.size;
  for (const tag of data.seasons) if (!item.seasons.includes(tag)) item.seasons.push(tag);
  await saveItems();
  return merged;
}

async function toggleSeason(item, seasonId) {
  const i = item.seasons.indexOf(seasonId);
  if (i < 0) item.seasons.push(seasonId);
  else item.seasons.splice(i, 1);
  await saveItems();
  renderLists();
}

async function removeFrom(item, kind) {
  item[LIST_FLAG[kind]] = false;
  if (!item.fav && !item.owned && !item.wish) {
    state.items = state.items.filter((x) => x.id !== item.id);
    if (state.profileId === item.id) state.profileId = null;
  }
  await saveItems();
  renderAll();
}

async function flip(item, kind) {
  if (kind === 'wish') { item.owned = true; item.wish = false; }
  else if (kind === 'fav') item.owned = !item.owned;
  else item.fav = !item.fav;
  await saveItems();
  renderAll();
}

const emptyBox = (title, text) => h('div', { class: 'empty' }, h('strong', null, title), text);

function flagsFor(item) {
  return h('div', { class: 'flags' },
    item.fav && h('span', { class: 'flag fav' }, 'Favorite'),
    item.owned && h('span', { class: 'flag own' }, 'Owned'),
    item.wish && h('span', { class: 'flag want' }, 'Want'));
}

function seasonChips(item) {
  return h('div', { class: 'chips' }, SEASONS.map((s) =>
    h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(item.seasons.includes(s.id)),
      title: `Tag or untag ${s.label}`,
      onclick: () => toggleSeason(item, s.id)
    }, s.label)));
}

function card(item, kind) {
  const meta = [item.concentration, item.size ? `${item.size} ml` : ''].filter(Boolean).join(' · ');
  const listName = { fav: 'favorites', wish: 'wishlist', own: 'collection' }[kind];
  const idleLabel = `Remove from ${listName}`;

  const removeBtn = h('button', { type: 'button', class: 'btn danger small' }, idleLabel);
  let armed = false;
  let timer = 0;
  removeBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      removeBtn.textContent = 'Click again to confirm';
      timer = setTimeout(() => { armed = false; removeBtn.textContent = idleLabel; }, 3000);
    } else {
      clearTimeout(timer);
      removeFrom(item, kind);
    }
  });

  const otherLabel = kind === 'wish' ? 'I own it now'
    : kind === 'fav' ? (item.owned ? 'Not in my collection' : 'I own this')
    : (item.fav ? 'Unfavorite' : 'Add to favorites');

  return h('article', { class: 'card' },
    h('div', { class: 'card-top' },
      h('div', null, h('div', { class: 'name' }, item.name), h('div', { class: 'brand' }, item.brand)),
      flagsFor(item)),
    meta && h('div', { class: 'meta' }, meta),
    seasonChips(item),
    h('div', { class: 'card-actions' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => flip(item, kind) }, otherLabel),
      h('button', {
        type: 'button', class: 'btn ghost small',
        onclick: () => { state.profileId = item.id; renderProfile(); location.hash = 'profile'; }
      }, 'Scent profile'),
      removeBtn));
}

function miniCard(item) {
  const perfumer = item.profile?.perfumer;
  return h('article', { class: 'card' },
    h('div', { class: 'card-top' },
      h('div', null, h('div', { class: 'name' }, item.name), h('div', { class: 'brand' }, item.brand)),
      flagsFor(item)),
    perfumer && h('div', { class: 'meta' }, `Perfumer: ${perfumer}`));
}

function fillShelf(listId, items, kind, emptyTitle, emptyText) {
  const list = $(listId);
  list.replaceChildren();
  if (!items.length) list.append(emptyBox(emptyTitle, emptyText));
  for (const item of items) list.append(card(item, kind));
}

function renderLists() {
  const { items } = state;
  fillShelf('favList', sorted(items.filter((i) => i.fav)), 'fav', 'No favorites yet', 'Add the first one with the form.');
  fillShelf('ownList', sorted(items.filter((i) => i.owned)), 'own', 'Your shelf is empty', 'Add a bottle you own with the form.');
  fillShelf('wishList', sorted(items.filter((i) => i.wish)), 'wish', 'Nothing on the wishlist', 'Add a perfume you want to try or buy with the form.');
  renderSeasons();
  renderStats();
}

function renderStats() {
  const { items } = state;
  const count = (test) => items.filter(test).length;
  $('stFav').textContent = count((i) => i.fav);
  $('stOwn').textContent = count((i) => i.owned);
  $('stWish').textContent = count((i) => i.wish);
  $('stProf').textContent = count((i) => {
    const p = i.profile ?? {};
    return p.perfumer || p.top || p.heart || p.base;
  });

  const counts = SEASONS.map((s) => count((i) => i.seasons.includes(s.id)));
  const max = Math.max(1, ...counts);
  const bars = $('bars');
  bars.replaceChildren();
  SEASONS.forEach((s, idx) => {
    const fill = h('i');
    fill.style.width = `${(counts[idx] / max) * 100}%`;
    bars.append(h('div', { class: 'bar' },
      h('span', null, s.label),
      h('div', { class: 'track' }, fill),
      h('span', { class: 'num' }, String(counts[idx]))));
  });
}

function renderSeasons() {
  const { items, activeSeason } = state;
  const grid = $('seasonGrid');
  grid.replaceChildren();
  for (const s of SEASONS) {
    const total = items.filter((i) => i.seasons.includes(s.id)).length;
    grid.append(h('button', {
      type: 'button',
      class: 'season-btn',
      'aria-pressed': String(s.id === activeSeason),
      onclick: () => { state.activeSeason = s.id; renderSeasons(); }
    }, h('b', null, String(total)), h('span', null, s.label)));
  }

  const list = $('seasonList');
  list.replaceChildren();
  const label = SEASONS.find((s) => s.id === activeSeason).label;
  const hits = sorted(items.filter((i) => i.seasons.includes(activeSeason)));
  if (!hits.length) list.append(emptyBox(`Nothing tagged ${label}`, 'Tag a bottle from any list and it shows up here.'));
  for (const item of hits) list.append(miniCard(item));

  const untagged = items.filter((i) => !i.seasons.length).length;
  if (untagged) {
    list.append(h('p', { class: 'dim' }, `${untagged} ${untagged === 1 ? 'bottle has' : 'bottles have'} no season tag yet.`));
  }
}

function noteRow(title, text) {
  const notes = splitList(text);
  return h('div', { class: 'tier' },
    h('span', { class: 't' }, title),
    notes.length
      ? h('div', { class: 'pills' }, notes.map((n) => h('span', { class: 'pill' }, n)))
      : h('span', { class: 'dim' }, 'Not added'));
}

function renderProfile() {
  const select = $('profSelect');
  const list = sorted(state.items);
  select.replaceChildren();
  if (!list.length) select.append(h('option', { value: '' }, 'Add a perfume first'));
  for (const i of list) select.append(h('option', { value: i.id }, `${i.brand} · ${i.name}`));

  if (!state.items.some((i) => i.id === state.profileId)) state.profileId = list[0]?.id ?? null;
  if (state.profileId) select.value = state.profileId;

  const item = state.items.find((i) => i.id === state.profileId);
  const p = item?.profile ?? {};
  $('profPerfumer').value = p.perfumer ?? '';
  $('profYear').value = p.year ?? '';
  $('profTop').value = p.top ?? '';
  $('profHeart').value = p.heart ?? '';
  $('profBase').value = p.base ?? '';
  $('profAccords').value = p.accords ?? '';

  const view = $('profView');
  view.replaceChildren();
  if (!item) {
    $('profTitle').textContent = 'Notes and perfumer';
    $('profSub').textContent = 'Choose a perfume to see its note pyramid.';
    $('profLookup').href = 'https://www.fragrantica.com/';
    return;
  }

  $('profTitle').textContent = item.name;
  $('profSub').textContent = item.brand;
  $('profLookup').href = `https://www.fragrantica.com/search/?query=${encodeURIComponent(`${item.name} ${item.brand}`)}`;

  view.append(
    h('div', { class: 'credits' },
      h('div', null, h('b', null, p.perfumer || 'Unknown'), h('span', null, 'Perfumer')),
      h('div', null, h('b', null, p.year ? String(p.year) : 'Unknown'), h('span', null, 'Launched'))),
    h('div', { class: 'pyramid' }, noteRow('Top', p.top), noteRow('Heart', p.heart), noteRow('Base', p.base)));

  const accords = splitList(p.accords);
  if (accords.length) {
    view.append(h('div', { class: 'tier spaced' },
      h('span', { class: 't' }, 'Accords'),
      h('div', { class: 'pills' }, accords.map((a) => h('span', { class: 'pill' }, a)))));
  }
}

function renderHeader() {
  const signedIn = Boolean(state.user);
  $('who').hidden = !signedIn;
  $('whoName').textContent = state.user ?? '';
  $('authView').hidden = signedIn;
  $('homeView').hidden = !signedIn;
  $('demoNotice').hidden = state.user !== 'demo';
  for (const id of LOCKED) {
    const section = $(id);
    section.querySelector('.lock').hidden = signedIn;
    section.querySelector('.body').hidden = !signedIn;
  }
}

function renderAll() {
  renderHeader();
  renderLists();
  renderProfile();
}

function showView() {
  let id = location.hash.replace('#', '');
  if (!VIEWS.includes(id)) id = 'account';
  for (const view of VIEWS) $(view).hidden = view !== id;
  for (const link of $$('a', $('tabs'))) {
    if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function buildSeasonPicker(containerId) {
  const box = $(containerId);
  box.replaceChildren();
  for (const s of SEASONS) {
    const input = h('input', { type: 'checkbox', value: s.id });
    const chip = h('label', { class: 'chip' }, input, s.label);
    input.addEventListener('change', () => chip.classList.toggle('on', input.checked));
    box.append(chip);
  }
}

const pickedSeasons = (containerId) => $$('input:checked', $(containerId)).map((i) => i.value);

function resetPicker(containerId) {
  for (const chip of $$('label', $(containerId))) {
    chip.classList.remove('on');
    chip.querySelector('input').checked = false;
  }
}

function syncListChips() {
  for (const chip of $$('.chip', $('wishLists'))) {
    chip.classList.toggle('on', chip.querySelector('input').checked);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;                 // read before any await
  const action = event.submitter?.value ?? 'signin';
  const name = $('authUser').value.trim().toLowerCase();
  const password = $('authPass').value;
  await withBusy(form, () => (action === 'signup' ? signUp(form, name, password) : signIn(form, name, password)));
}

async function handleFavSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = norm($('favName').value);
  const brand = norm($('favBrand').value);
  if (!name || !brand) return say('favStatus', 'Enter both a name and a brand.', true);

  const merged = await addItem('fav', { name, brand, seasons: pickedSeasons('favSeasons') });
  form.reset();
  resetPicker('favSeasons');
  say('favStatus', merged ? `${name} was already on your shelf, so it is now marked as a favorite too.` : `${name} added to favorites.`);
  renderAll();
  $('favName').focus();
}

async function handleOwnSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = norm($('ownName').value);
  const brand = norm($('ownBrand').value);
  if (!name || !brand) return say('ownStatus', 'Enter both a name and a brand.', true);

  const size = parseInt($('ownSize').value, 10);
  const merged = await addItem('own', {
    name, brand, concentration: $('ownConc').value, size: size > 0 ? size : '', seasons: pickedSeasons('ownSeasons')
  });
  form.reset();
  resetPicker('ownSeasons');
  say('ownStatus', merged ? `${name} was already listed, so it is now marked as owned too.` : `${name} added to your collection.`);
  renderAll();
  $('ownName').focus();
}

async function handleWishSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = norm($('wishName').value);
  const brand = norm($('wishBrand').value);
  if (!name || !brand) return say('wishStatus', 'Enter both a name and a brand.', true);

  const chosen = [
    ['fav', $('wishFav').checked, 'favorites'],
    ['own', $('wishOwn').checked, 'your collection'],
    ['wish', $('wishWant').checked, 'your wishlist']
  ].filter(([, checked]) => checked);
  if (!chosen.length) return say('wishStatus', 'Pick at least one list to add it to.', true);

  const size = parseInt($('wishSize').value, 10);
  const merged = await addItem(chosen.map(([kind]) => kind), {
    name, brand, concentration: $('wishConc').value, size: size > 0 ? size : '', seasons: pickedSeasons('wishSeasons')
  });
  form.reset();
  resetPicker('wishSeasons');
  syncListChips();
  const where = chosen.map(([, , label]) => label).join(' and ');
  say('wishStatus', `${name} ${merged ? 'was already saved, so it was also added to' : 'added to'} ${where}.`);
  renderAll();
  $('wishName').focus();
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const item = state.items.find((i) => i.id === state.profileId);
  if (!item) return say('profStatus', 'Add a perfume first.', true);

  const year = parseInt($('profYear').value, 10);
  item.profile = {
    perfumer: norm($('profPerfumer').value),
    year: year > 0 ? year : '',
    top: norm($('profTop').value),
    heart: norm($('profHeart').value),
    base: norm($('profBase').value),
    accords: norm($('profAccords').value)
  };
  await saveItems();
  say('profStatus', `Saved the profile for ${item.name}.`);
  renderProfile();
  renderStats();
}

function bindEvents() {
  $('authForm').addEventListener('submit', handleAuthSubmit);
  $('demoBtn').addEventListener('click', openDemo);
  $('signOut').addEventListener('click', logout);
  $('favForm').addEventListener('submit', handleFavSubmit);
  $('ownForm').addEventListener('submit', handleOwnSubmit);
  $('wishForm').addEventListener('submit', handleWishSubmit);
  $$('input', $('wishLists')).forEach((input) => input.addEventListener('change', syncListChips));
  $('profSelect').addEventListener('change', () => {
    state.profileId = $('profSelect').value;
    say('profStatus');
    renderProfile();
  });
  $('profForm').addEventListener('submit', handleProfileSubmit);
  window.addEventListener('hashchange', showView);
}

async function init() {
  ['favSeasons', 'ownSeasons', 'wishSeasons'].forEach(buildSeasonPicker);
  bindEvents();

  const [session, users] = await Promise.all([storage.get(KEYS.session), storage.get(KEYS.users)]);
  if (session && users?.[session]) {
    state.user = session;
    await loadItems();
  }
  renderAll();
  showView();
}

document.addEventListener('DOMContentLoaded', init);
