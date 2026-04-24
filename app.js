/**********************************************************************
 * SortirCeSoir V2
 * Frontend vanilla JS + Supabase
 *
 * À MODIFIER ICI :
 **********************************************************************/
const SUPABASE_URL = "https://qjuhfvwqdvdcixsseept.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LgSVWHH36Mtd_tXohem4UA_ZP2Rsaa7";
/**********************************************************************/

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let profile = null;
let friendsCache = [];
let conversationsCache = [];
let currentConversation = null;
let sharePayload = null;
let discoverFilter = "all";
let channels = [];

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(p) {
  const a = p?.first_name?.[0] || "";
  const b = p?.last_name?.[0] || "";
  return (a + b).toUpperCase() || "🙂";
}

function colorFromText(text = "SortirCeSoir") {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360} 75% 48%)`;
}

function avatarMarkup(p, cls = "mini-avatar") {
  if (p?.avatar_url) return `<div class="${cls}"><img src="${escapeHTML(p.avatar_url)}" alt=""></div>`;
  const name = `${p?.first_name || ""}${p?.last_name || ""}`;
  return `<div class="${cls}" style="background:${colorFromText(name)}">${escapeHTML(initials(p))}</div>`;
}

function profileName(p) {
  if (!p) return "Utilisateur";
  return `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.username || "Utilisateur";
}

function openModal(id) { $(id).classList.add("show"); }
function closeModal(id) { $(id).classList.remove("show"); }

function setView(view) {
  $$(".view").forEach(v => v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  $$("[data-view-target]").forEach(btn => btn.classList.toggle("active", btn.dataset.viewTarget === view));

  if (view === "discover") loadDiscoverFeed();
  if (view === "outings") searchEstablishments();
  if (view === "favorites") loadFavorites();
  if (view === "chat") loadChatHome();
  if (view === "profile") loadProfileView();
}

async function uploadFile(bucket, file, folder) {
  if (!file) return null;
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseClient.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function init() {
  bindEvents();

  const params = new URLSearchParams(location.search);
  if (params.get("invite")) {
    await showPublicInvite(params.get("invite"));
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  await renderAuthState();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    await renderAuthState();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  $$("[data-view-target]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.viewTarget)));
  $$('[data-close-modal]').forEach(btn => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));

  $$("[data-auth-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("[data-auth-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $("authSubmit").textContent = btn.dataset.authTab === "signup" ? "Créer mon compte" : "Se connecter";
    });
  });

  $("authForm").addEventListener("submit", handleAuth);
  $("profileForm").addEventListener("submit", saveProfile);
  $("logoutBtn").addEventListener("click", logout);
  $("settingsBtn").addEventListener("click", () => openModal("settingsModal"));
  $("profileNewPostBtn").addEventListener("click", () => openModal("postModal"));
  $("openCreatePostBtn").addEventListener("click", () => openModal("postModal"));
  $("postForm").addEventListener("submit", createPost);
  $("searchEstablishmentBtn").addEventListener("click", searchEstablishments);
  $("establishmentSearch").addEventListener("input", debounce(searchEstablishments, 350));
  $("establishmentForm").addEventListener("submit", addEstablishment);
  $("refreshFavoritesBtn").addEventListener("click", loadFavorites);
  $("openFriendPanelBtn").addEventListener("click", () => { openModal("friendsModal"); loadFriendsPanel(); });
  $("searchFriendBtn").addEventListener("click", searchFriend);
  $("messageForm").addEventListener("submit", sendTextMessage);
  $("chatDeleteBtn").addEventListener("click", () => openModal("deleteConversationModal"));
  $("deleteForMeBtn").addEventListener("click", () => deleteConversation("me"));
  $("deleteForAllBtn").addEventListener("click", () => deleteConversation("all"));

  $$("[data-discover-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("[data-discover-filter]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      discoverFilter = btn.dataset.discoverFilter;
      loadDiscoverFeed();
    });
  });
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const mode = document.querySelector("[data-auth-tab].active").dataset.authTab;

  const result = mode === "signup"
    ? await supabaseClient.auth.signUp({ email, password })
    : await supabaseClient.auth.signInWithPassword({ email, password });

  if (result.error) {
    toast(result.error.message);
    return;
  }

  toast(mode === "signup" ? "Compte créé. Crée ton profil." : "Connecté.");
}

async function renderAuthState() {
  if (!currentUser) {
    $("authShell").classList.add("active");
    $("authShell").classList.remove("hidden");
    $("appShell").classList.add("hidden");
    $("bottomNav").classList.add("hidden");
    return;
  }

  await loadProfile();
  $("authShell").classList.remove("active");
  $("authShell").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("bottomNav").classList.remove("hidden");

  await loadHome();
  await loadChatUnreadCount();
  subscribeRealtime();

  if (!profile) {
    toast("Crée ton profil pour continuer.");
    openModal("settingsModal");
    setView("profile");
  }
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();
  if (error) console.error(error);
  profile = data || null;
  fillProfileForm();
  updateTopAvatar();
}

function fillProfileForm() {
  if (!profile) return;
  $("pFirst").value = profile.first_name || "";
  $("pLast").value = profile.last_name || "";
  $("pUsername").value = profile.username || "";
  $("pCity").value = profile.city || "";
  $("pBio").value = profile.bio || "";
}

function updateTopAvatar() {
  const html = avatarMarkup(profile, "avatar-btn");
  $("topProfileBtn").outerHTML = html.replace('<div class="avatar-btn"', '<button id="topProfileBtn" class="avatar-btn" data-view-target="profile"');
  $("topProfileBtn").addEventListener("click", () => setView("profile"));
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    let avatarUrl = profile?.avatar_url || null;
    const file = $("pAvatarFile").files[0];
    if (file) avatarUrl = await uploadFile("avatars", file, currentUser.id);

    const payload = {
      id: currentUser.id,
      first_name: $("pFirst").value.trim(),
      last_name: $("pLast").value.trim(),
      username: $("pUsername").value.trim().toLowerCase(),
      city: $("pCity").value.trim(),
      bio: $("pBio").value.trim(),
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient.from("profiles").upsert(payload, { onConflict: "id" });
    if (error) throw error;
    toast("Profil enregistré.");
    closeModal("settingsModal");
    await loadProfile();
    await loadProfileView();
  } catch (err) {
    console.error(err);
    toast("Impossible d’enregistrer le profil.");
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  location.href = location.pathname;
}

async function loadHome() {
  $("welcome").textContent = profile?.first_name ? `Bonsoir ${profile.first_name} 👋` : "Bonsoir 👋";
  const { data } = await supabaseClient
    .from("messages")
    .select("*, conversations!inner(user1_id,user2_id,deleted_for_all)")
    .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`, { foreignTable: "conversations" })
    .eq("conversations.deleted_for_all", false)
    .order("created_at", { ascending: false })
    .limit(5);

  $("homeNotifications").innerHTML = (data || []).map(m => `
    <div class="notif-card card">
      <b>${m.system_message ? "Notification" : "Message"}</b>
      <span>${escapeHTML(m.content || "")}</span>
    </div>
  `).join("") || `<div class="card">Aucune notification pour le moment.</div>`;
}

async function loadDiscoverFeed() {
  let query = supabaseClient
    .from("discover_posts")
    .select(`
      *,
      profiles:author_id(id, first_name, last_name, username, avatar_url, city),
      discover_post_likes(user_id),
      discover_post_comments(id, content, created_at, profiles:user_id(first_name,last_name,username,avatar_url))
    `)
    .order("created_at", { ascending: false })
    .limit(40);

  if (discoverFilter !== "all") query = query.eq("type", discoverFilter);
  const { data, error } = await query;
  if (error) {
    console.error(error);
    $("discoverFeed").innerHTML = `<div class="card">Impossible de charger Découvrir. As-tu lancé le SQL V2 ?</div>`;
    return;
  }

  $("discoverFeed").innerHTML = (data || []).map(renderPostCard).join("") || `<div class="card">Aucune publication pour le moment.</div>`;
}

function renderPostCard(post) {
  const author = post.profiles;
  const liked = (post.discover_post_likes || []).some(l => l.user_id === currentUser.id);
  const likes = post.discover_post_likes?.length || 0;
  const comments = (post.discover_post_comments || []).slice(-3);
  const image = post.image_url || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80";

  return `
    <article class="post-card" data-post-id="${post.id}">
      <div class="post-head">
        ${avatarMarkup(author)}
        <div>
          <b>${escapeHTML(profileName(author))}</b>
          <div class="post-meta">@${escapeHTML(author?.username || "user")} · ${escapeHTML(post.city || "")}</div>
        </div>
      </div>
      <img class="post-img" src="${escapeHTML(image)}" alt="${escapeHTML(post.title)}" loading="lazy" />
      <div class="post-body">
        <div class="post-title">${escapeHTML(post.title)}</div>
        <div class="post-meta">${escapeHTML(post.type || "activité")} · ${post.rating ? `⭐ ${post.rating}/5 · ` : ""}${escapeHTML(post.address || "")}</div>
        <p>${escapeHTML(post.caption || "")}</p>
        <div class="post-actions">
          <button class="${liked ? "liked" : ""}" onclick="togglePostLike('${post.id}')">${liked ? "♥" : "♡"}</button>
          <b>${likes}</b>
          <button onclick="focusComment('${post.id}')">💬</button>
          <button onclick="openSharePost('${post.id}', '${escapeHTML(post.title)}')">↗️</button>
        </div>
        <div class="comments">
          ${comments.map(c => `<div class="comment"><b>${escapeHTML(c.profiles?.username || "user")}</b> ${escapeHTML(c.content)}</div>`).join("")}
        </div>
        <form class="comment-box" onsubmit="addComment(event,'${post.id}')">
          <input id="comment-${post.id}" placeholder="Ajouter un commentaire..." />
          <button class="btn dark">OK</button>
        </form>
      </div>
    </article>
  `;
}

async function createPost(e) {
  e.preventDefault();
  try {
    let imageUrl = $("postImageUrl").value.trim() || null;
    const file = $("postPhotoFile").files[0];
    if (file) imageUrl = await uploadFile("discover-media", file, currentUser.id);

    const payload = {
      author_id: currentUser.id,
      title: $("postTitle").value.trim(),
      city: $("postCity").value.trim(),
      address: $("postAddress").value.trim(),
      type: $("postType").value,
      image_url: imageUrl,
      caption: $("postCaption").value.trim(),
      rating: $("postRating").value ? Number($("postRating").value) : null
    };

    const { error } = await supabaseClient.from("discover_posts").insert(payload);
    if (error) throw error;
    toast("Publication ajoutée.");
    $("postForm").reset();
    closeModal("postModal");
    setView("discover");
    await loadDiscoverFeed();
    await loadProfileView();
  } catch (err) {
    console.error(err);
    toast("Impossible de publier.");
  }
}

async function togglePostLike(postId) {
  const { data } = await supabaseClient.from("discover_post_likes").select("id").eq("post_id", postId).eq("user_id", currentUser.id).maybeSingle();
  if (data) {
    await supabaseClient.from("discover_post_likes").delete().eq("id", data.id);
  } else {
    await supabaseClient.from("discover_post_likes").insert({ post_id: postId, user_id: currentUser.id });
  }
  await loadDiscoverFeed();
}

function focusComment(postId) { $(`comment-${postId}`)?.focus(); }

async function addComment(event, postId) {
  event.preventDefault();
  const input = $(`comment-${postId}`);
  const content = input.value.trim();
  if (!content) return;
  const { error } = await supabaseClient.from("discover_post_comments").insert({ post_id: postId, user_id: currentUser.id, content });
  if (error) return toast("Commentaire impossible.");
  input.value = "";
  await loadDiscoverFeed();
}

function openSharePost(postId, title) {
  sharePayload = { kind: "post", post_id: postId, title };
  openShareModal();
}

async function searchEstablishments() {
  const term = $("establishmentSearch").value.trim();
  let query = supabaseClient.from("establishments").select("*").order("created_at", { ascending: false }).limit(30);
  if (term) query = query.ilike("name", `%${term}%`);
  const { data, error } = await query;
  if (error) {
    console.error(error);
    $("establishmentResults").innerHTML = `<div class="card">Lance le SQL V2 pour utiliser les établissements.</div>`;
    return;
  }
  $("establishmentResults").innerHTML = (data || []).map(est => `
    <div class="card est-card">
      <b>${escapeHTML(est.name)}</b>
      <span class="post-meta">${escapeHTML(est.city)} · ${escapeHTML(est.type || "activité")} · ${escapeHTML(est.budget_label || "")}</span>
      <span>${escapeHTML(est.address || "")}</span>
      <p>${escapeHTML(est.description || "")}</p>
      <div class="hero-actions">
        ${est.maps_url ? `<a class="btn dark" href="${escapeHTML(est.maps_url)}" target="_blank">Y aller</a>` : ""}
        <button class="btn primary" onclick="saveEstablishmentFavorite('${est.id}')">Sauvegarder</button>
        <button class="btn light" onclick="openShareEstablishment('${est.id}','${escapeHTML(est.name)}')">Envoyer</button>
      </div>
    </div>
  `).join("") || `<div class="card">Aucun établissement trouvé. Tu peux l’ajouter.</div>`;
}

async function addEstablishment(e) {
  e.preventDefault();
  const payload = {
    created_by: currentUser.id,
    name: $("estName").value.trim(),
    city: $("estCity").value.trim(),
    address: $("estAddress").value.trim(),
    type: $("estType").value,
    budget_label: $("estBudget").value.trim(),
    maps_url: $("estMaps").value.trim(),
    description: $("estDescription").value.trim()
  };
  const { error } = await supabaseClient.from("establishments").insert(payload);
  if (error) return toast("Impossible d’ajouter l’établissement.");
  toast("Établissement ajouté.");
  $("establishmentForm").reset();
  await searchEstablishments();
}

async function saveEstablishmentFavorite(establishmentId) {
  const { error } = await supabaseClient.from("favorite_establishments").insert({ user_id: currentUser.id, establishment_id: establishmentId });
  if (error && !String(error.message).includes("duplicate")) return toast("Impossible de sauvegarder.");
  toast("Ajouté aux favoris.");
}

function openShareEstablishment(id, title) {
  sharePayload = { kind: "establishment", establishment_id: id, title };
  openShareModal();
}

async function loadFavorites() {
  const { data, error } = await supabaseClient
    .from("favorite_establishments")
    .select("*, establishments(*)")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });
  if (error) {
    $("favoritesList").innerHTML = `<div class="card">Tes anciens favoris de sorties restent dans la table favorites. Ici, ce sont les établissements V2.</div>`;
    return;
  }
  $("favoritesList").innerHTML = (data || []).map(f => `
    <div class="card">
      <b>${escapeHTML(f.establishments?.name || "Établissement")}</b>
      <p>${escapeHTML(f.establishments?.city || "")} · ${escapeHTML(f.establishments?.address || "")}</p>
      <button class="btn light" onclick="openShareEstablishment('${f.establishment_id}','${escapeHTML(f.establishments?.name || "Établissement")}')">Envoyer à un ami</button>
    </div>
  `).join("") || `<div class="card">Aucun favori pour le moment.</div>`;
}

async function loadFriendsPanel() {
  await loadFriendRequests();
  await loadFriends();
}

async function searchFriend() {
  const input = $("friendSearch");
  const resultBox = $("friendSearchResult");

  const q = input.value.trim().replace(/^@/, "");

  resultBox.innerHTML = "";

  if (!q) {
    resultBox.innerHTML = `<div class="card">Entre un pseudo à rechercher.</div>`;
    return;
  }

  resultBox.innerHTML = `<div class="card">Recherche en cours...</div>`;

  const { data, error } = await supabaseClient.rpc("search_profiles_by_username", {
    p_query: q
  });

  if (error) {
    console.error(error);
    resultBox.innerHTML = `<div class="card">Recherche impossible.</div>`;
    toast("Recherche impossible.");
    return;
  }

  if (!data || data.length === 0) {
    resultBox.innerHTML = `<div class="card">Aucun utilisateur trouvé.</div>`;
    return;
  }

  resultBox.innerHTML = data.map(u => `
    <div class="card row" style="justify-content:space-between">
      <div class="row">
        ${avatarMarkup(u)}
        <div>
          <b>${escapeHTML(profileName(u))}</b>
          <div class="post-meta">@${escapeHTML(u.username || "")}</div>
        </div>
      </div>

      <button
        class="btn dark"
        data-friend-button="${u.id}"
        onclick="sendFriendRequest('${u.id}')"
      >
        Ajouter
      </button>
    </div>
  `).join("");
}

async function sendFriendRequest(receiverId) {
  const button = document.querySelector(`[data-friend-button="${receiverId}"]`);

  if (button) {
    button.disabled = true;
    button.textContent = "Envoi...";
  }

  const { error } = await supabaseClient
    .from("friend_requests")
    .insert({
      sender_id: currentUser.id,
      receiver_id: receiverId,
      status: "pending"
    });

  if (error) {
    console.error(error);

    if (button) {
      button.disabled = false;
      button.textContent = "Ajouter";
    }

    toast("Demande déjà envoyée ou impossible.");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Envoyée ✅";
    button.classList.remove("dark");
    button.classList.add("ghost");
  }

  toast("Demande d’ami envoyée ✅");
}
async function loadFriendRequests() {
  const { data } = await supabaseClient
    .from("friend_requests")
    .select("*, profiles:sender_id(id,first_name,last_name,username,avatar_url)")
    .eq("receiver_id", currentUser.id)
    .eq("status", "pending");
  $("friendRequests").innerHTML = (data || []).map(r => `
    <div class="card row" style="justify-content:space-between">
      <div class="row">${avatarMarkup(r.profiles)}<b>${escapeHTML(profileName(r.profiles))}</b></div>
      <div><button class="btn primary" onclick="respondFriend('${r.id}','accepted','${r.sender_id}')">OK</button><button class="btn danger" onclick="respondFriend('${r.id}','declined','${r.sender_id}')">Non</button></div>
    </div>
  `).join("") || `<div class="post-meta">Aucune demande.</div>`;
}

async function respondFriend(requestId, status, senderId) {
  await supabaseClient.from("friend_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", requestId);
  if (status === "accepted") {
    await supabaseClient.from("friendships").upsert([
      { user_id: currentUser.id, friend_id: senderId },
      { user_id: senderId, friend_id: currentUser.id }
    ], { onConflict: "user_id,friend_id" });
  }
  await loadFriendsPanel();
}

async function loadFriends() {
  const { data, error } = await supabaseClient
    .from("friendships")
    .select("friend_id, profiles:friend_id(id,first_name,last_name,username,avatar_url,city)")
    .eq("user_id", currentUser.id);
  friendsCache = (data || []).map(x => x.profiles).filter(Boolean);
  $("friendsList").innerHTML = friendsCache.map(f => `
    <div class="card row" style="justify-content:space-between">
      <div class="row">${avatarMarkup(f)}<div><b>${escapeHTML(profileName(f))}</b><div class="post-meta">@${escapeHTML(f.username || "")}</div></div></div>
      <button class="btn dark" onclick="openOrCreateConversation('${f.id}')">Message</button>
    </div>
  `).join("") || `<div class="post-meta">Aucun ami pour le moment.</div>`;
}

async function loadChatHome() {
  await loadFriends();
  const { data, error } = await supabaseClient
    .from("conversations")
    .select(`*, messages(id,content,created_at,read_at,sender_id,system_message,kind,metadata), user1:user1_id(id,first_name,last_name,username,avatar_url), user2:user2_id(id,first_name,last_name,username,avatar_url)`)
    .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
    .eq("deleted_for_all", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    $("conversationsList").innerHTML = `<div class="card">Impossible de charger les conversations.</div>`;
    return;
  }

  const { data: deletions } = await supabaseClient.from("conversation_deletions").select("conversation_id").eq("user_id", currentUser.id);
  const hidden = new Set((deletions || []).map(d => d.conversation_id));
  conversationsCache = (data || []).filter(c => !hidden.has(c.id));

  $("conversationsList").innerHTML = conversationsCache.map(renderConversationRow).join("") || `<div class="card">Aucune conversation. Ajoute un ami avec le bouton +.</div>`;
  attachSwipeHandlers();
  await loadChatUnreadCount();
}

function otherUser(conv) {
  return conv.user1_id === currentUser.id ? conv.user2 : conv.user1;
}

function renderConversationRow(conv) {
  const other = otherUser(conv) || { username: conv.guest_name || "Invité" };
  const messages = (conv.messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const last = messages[messages.length - 1];
  const unread = messages.filter(m => !m.read_at && m.sender_id && m.sender_id !== currentUser.id).length;
  return `
    <div class="conversation-row" data-conversation-id="${conv.id}">
      <div class="conversation-delete-bg">Supprimer</div>
      <div class="conversation-card" onclick="openConversation('${conv.id}')">
        <div class="row">
          ${avatarMarkup(other)}
          <div>
            <div class="title">${escapeHTML(profileName(other))}</div>
            <div class="preview">${escapeHTML(last?.content || "Nouvelle conversation")}</div>
          </div>
        </div>
        <div class="row">
          ${unread ? `<b class="badge show">${unread}</b>` : ""}
          <button class="icon-btn desktop-delete" onclick="event.stopPropagation(); askDeleteConversation('${conv.id}')">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

function attachSwipeHandlers() {
  if (!matchMedia("(hover: none) and (pointer: coarse)").matches) return;
  $$(".conversation-row").forEach(row => {
    let startX = 0;
    let dx = 0;
    const card = row.querySelector(".conversation-card");
    row.addEventListener("touchstart", e => { startX = e.touches[0].clientX; dx = 0; }, { passive: true });
    row.addEventListener("touchmove", e => {
      dx = e.touches[0].clientX - startX;
      if (dx > 0) card.style.transform = `translateX(${Math.min(dx, 110)}px)`;
    }, { passive: true });
    row.addEventListener("touchend", () => {
      if (dx > 90) askDeleteConversation(row.dataset.conversationId);
      card.style.transform = "";
    });
  });
}

function askDeleteConversation(conversationId) {
  currentConversation = conversationsCache.find(c => c.id === conversationId) || currentConversation;
  openModal("deleteConversationModal");
}

async function openOrCreateConversation(friendId) {
  const id = await ensureConversation(friendId);
  closeModal("friendsModal");
  await loadChatHome();
  openConversation(id);
}

async function ensureConversation(friendId) {
  const { data: existing } = await supabaseClient
    .from("conversations")
    .select("id")
    .or(`and(user1_id.eq.${currentUser.id},user2_id.eq.${friendId}),and(user1_id.eq.${friendId},user2_id.eq.${currentUser.id})`)
    .eq("deleted_for_all", false)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabaseClient.from("conversations").insert({ user1_id: currentUser.id, user2_id: friendId }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function openConversation(conversationId) {
  const { data, error } = await supabaseClient
    .from("conversations")
    .select(`*, user1:user1_id(id,first_name,last_name,username,avatar_url), user2:user2_id(id,first_name,last_name,username,avatar_url)`)
    .eq("id", conversationId)
    .single();
  if (error) return toast("Conversation introuvable.");
  currentConversation = data;
  const other = otherUser(data);
  $("chatTitle").textContent = profileName(other);
  $("chatSubtitle").textContent = other?.username ? `@${other.username}` : "";
  openModal("chatModal");
  await loadMessages(conversationId);
  await markConversationRead(conversationId);
}

async function loadMessages(conversationId) {
  const { data, error } = await supabaseClient.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
  if (error) return;
  $("messagesList").innerHTML = (data || []).map(renderMessage).join("");
  $("messagesList").scrollTop = $("messagesList").scrollHeight;
}

function renderMessage(m) {
  const mine = m.sender_id === currentUser.id;
  const deleted = m.deleted_at;
  let extra = "";
  if (m.metadata?.kind === "post") extra = `<div class="msg-card">📸 Publication : ${escapeHTML(m.metadata.title || "")}</div>`;
  if (m.metadata?.kind === "establishment") extra = `<div class="msg-card">📍 Sortie : ${escapeHTML(m.metadata.title || "")}</div>`;
  return `<div class="msg ${mine ? "mine" : ""} ${m.system_message ? "system" : ""} ${deleted ? "deleted" : ""}">${deleted ? "Message supprimé" : escapeHTML(m.content || "")}${extra}</div>`;
}

async function sendTextMessage(e) {
  e.preventDefault();
  const content = $("messageInput").value.trim();
  if (!content || !currentConversation) return;
  const { error } = await supabaseClient.from("messages").insert({ conversation_id: currentConversation.id, sender_id: currentUser.id, content, system_message: false, kind: "text" });
  if (error) return toast("Message impossible.");
  $("messageInput").value = "";
  await loadMessages(currentConversation.id);
  await loadChatHome();
}

async function markConversationRead(conversationId) {
  await supabaseClient.from("messages").update({ read_at: new Date().toISOString() }).eq("conversation_id", conversationId).neq("sender_id", currentUser.id).is("read_at", null);
  await loadChatUnreadCount();
}

async function loadChatUnreadCount() {
  if (!currentUser) return;
  const { data } = await supabaseClient.from("conversations").select("id").or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`).eq("deleted_for_all", false);
  const ids = (data || []).map(c => c.id);
  if (!ids.length) return $("chatBadge").classList.remove("show");
  const { count } = await supabaseClient.from("messages").select("id", { count: "exact", head: true }).in("conversation_id", ids).neq("sender_id", currentUser.id).is("read_at", null);
  $("chatBadge").textContent = count || 0;
  $("chatBadge").classList.toggle("show", !!count);
}

async function deleteConversation(mode) {
  if (!currentConversation?.id) return;
  if (mode === "me") {
    await supabaseClient.from("conversation_deletions").upsert({ conversation_id: currentConversation.id, user_id: currentUser.id }, { onConflict: "conversation_id,user_id" });
  } else {
    await supabaseClient.from("conversations").update({ deleted_for_all: true, deleted_at: new Date().toISOString(), deleted_by: currentUser.id }).eq("id", currentConversation.id);
  }
  closeModal("deleteConversationModal");
  closeModal("chatModal");
  toast("Conversation supprimée.");
  await loadChatHome();
}

async function openShareModal() {
  await loadFriends();
  $("shareFriendsList").innerHTML = friendsCache.map(f => `
    <button class="card row" style="width:100%;justify-content:space-between;text-align:left" onclick="sendShareToFriend('${f.id}')">
      <span class="row">${avatarMarkup(f)}<b>${escapeHTML(profileName(f))}</b></span>
      <span>Envoyer</span>
    </button>
  `).join("") || `<div class="card">Ajoute d’abord un ami.</div>`;
  openModal("shareModal");
}

async function sendShareToFriend(friendId) {
  if (!sharePayload) return;
  const convId = await ensureConversation(friendId);
  const content = sharePayload.kind === "post" ? `Je t’envoie cette publication : ${sharePayload.title}` : `Je t’envoie cette sortie : ${sharePayload.title}`;
  await supabaseClient.from("messages").insert({ conversation_id: convId, sender_id: currentUser.id, content, kind: sharePayload.kind, metadata: sharePayload });
  closeModal("shareModal");
  toast("Envoyé.");
}

async function loadProfileView() {
  if (!profile) return;
  $("profileAvatar").innerHTML = profile.avatar_url ? `<img src="${escapeHTML(profile.avatar_url)}" alt="">` : initials(profile);
  if (!profile.avatar_url) $("profileAvatar").style.background = colorFromText(profileName(profile));
  $("profileName").textContent = profileName(profile);
  $("profileMeta").textContent = `@${profile.username || ""} · ${profile.city || ""}`;
  $("profileBio").textContent = profile.bio || "Aucune bio pour le moment.";

  const [{ count: followers }, { data: likes }, { count: profileViews }, { data: posts }] = await Promise.all([
    supabaseClient.from("follows").select("id", { count: "exact", head: true }).eq("following_id", currentUser.id),
    supabaseClient.from("discover_posts").select("id, discover_post_likes(id)").eq("author_id", currentUser.id),
    supabaseClient.from("profile_views").select("id", { count: "exact", head: true }).eq("profile_id", currentUser.id),
    supabaseClient.from("discover_posts").select("id,title,image_url,view_count").eq("author_id", currentUser.id).order("created_at", { ascending: false })
  ]);

  const totalLikes = (likes || []).reduce((sum, p) => sum + (p.discover_post_likes?.length || 0), 0);
  const totalViews = (posts || []).reduce((sum, p) => sum + (p.view_count || 0), 0);
  $("statFollowers").textContent = followers || 0;
  $("statLikes").textContent = totalLikes;
  $("statProfileViews").textContent = profileViews || 0;
  $("statMediaViews").textContent = totalViews;

  $("myPostsGrid").innerHTML = (posts || []).map(p => `<img src="${escapeHTML(p.image_url || "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80")}" alt="${escapeHTML(p.title)}">`).join("") || `<div class="card" style="grid-column:1/-1">Aucune publication.</div>`;
}

async function showPublicInvite(token) {
  $("authShell").classList.add("hidden");
  $("appShell").classList.add("hidden");
  $("bottomNav").classList.add("hidden");
  $("inviteShell").classList.remove("hidden");

  const { data, error } = await supabaseClient.rpc("get_invitation_by_token", { p_token: token });
  if (error || !data) {
    $("invitePublicContent").innerHTML = `<p>Invitation introuvable.</p>`;
    return;
  }
  const inv = Array.isArray(data) ? data[0] : data;
  $("invitePublicContent").innerHTML = `
    <h2>${escapeHTML(inv.sender_name || "Quelqu’un")} t’invite à sortir</h2>
    <p><b>${escapeHTML(inv.outing_name || "Sortie")}</b></p>
    <p>${escapeHTML(inv.message || "Ça te dit ?")}</p>
    <input id="guestName" placeholder="Ton prénom" />
    <button class="btn primary full-btn" onclick="respondPublicInvite('${token}','accepted')">Oui, je suis partant</button>
    <button class="btn danger full-btn" onclick="respondPublicInvite('${token}','declined')">Non, je ne peux pas</button>
  `;
}

async function respondPublicInvite(token, status) {
  const guestName = $("guestName")?.value.trim() || "Invité";
  const { error } = await supabaseClient.rpc("respond_to_invitation", { p_token: token, p_status: status, p_guest_name: guestName });
  if (error) return toast("Réponse impossible.");
  $("invitePublicContent").innerHTML = `<h2>Réponse envoyée ✅</h2><p>L’organisateur a été prévenu dans Discussion.</p>`;
}

function subscribeRealtime() {
  channels.forEach(ch => supabaseClient.removeChannel(ch));
  channels = [];
  const ch = supabaseClient.channel("sortircesoir-v2")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async () => {
      if (currentConversation) await loadMessages(currentConversation.id);
      await loadChatHome();
      await loadHome();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "discover_posts" }, () => {
      if (!$('view-discover').classList.contains('hidden')) loadDiscoverFeed();
    })
    .subscribe();
  channels.push(ch);
}

window.togglePostLike = togglePostLike;
window.focusComment = focusComment;
window.addComment = addComment;
window.openSharePost = openSharePost;
window.saveEstablishmentFavorite = saveEstablishmentFavorite;
window.openShareEstablishment = openShareEstablishment;
window.sendFriendRequest = sendFriendRequest;
window.respondFriend = respondFriend;
window.openOrCreateConversation = openOrCreateConversation;
window.openConversation = openConversation;
window.askDeleteConversation = askDeleteConversation;
window.sendShareToFriend = sendShareToFriend;
window.respondPublicInvite = respondPublicInvite;

init();
