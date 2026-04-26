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
let activeCommentsPostId = null;
let adminMode = false;

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

function openModal(id) {
  $(id)?.classList.add("show");
  if (id === "chatModal") document.body.classList.add("chat-open");
}
function closeModal(id) {
  $(id)?.classList.remove("show");
  if (id === "chatModal") {
    document.body.classList.remove("chat-open");
    currentConversation = null;
  }
}

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
  $("openReportBtn")?.addEventListener("click", () => openReportModal());
  $("reportForm")?.addEventListener("submit", submitReport);
  $("commentsModalForm")?.addEventListener("submit", submitModalComment);
  $("adminLogoutBtn")?.addEventListener("click", logout);
  $("adminRefreshReportsBtn")?.addEventListener("click", loadAdminReports);
  $("adminRefreshPostsBtn")?.addEventListener("click", loadAdminPosts);
  $("adminSearchUsersBtn")?.addEventListener("click", loadAdminUsers);
  $("adminLoadMessagesBtn")?.addEventListener("click", loadAdminMessagesForUser);
  $("adminEstablishmentForm")?.addEventListener("submit", adminAddEstablishment);
  $$('[data-admin-tab]').forEach(btn => btn.addEventListener('click', () => setAdminTab(btn.dataset.adminTab)));

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
  let email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (email === "/admin") email = "admin@sortircesoir.local";
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
    adminMode = false;
    $("authShell").classList.add("active");
    $("authShell").classList.remove("hidden");
    $("appShell").classList.add("hidden");
    $("adminShell")?.classList.add("hidden");
    $("bottomNav").classList.add("hidden");
    return;
  }

  await loadProfile();

  const bannedPermanent = !!profile?.banned_permanent;
  const bannedUntil = profile?.banned_until ? new Date(profile.banned_until) : null;
  if (bannedPermanent || (bannedUntil && bannedUntil > new Date())) {
    await supabaseClient.auth.signOut();
    toast("Compte banni " + (bannedPermanent ? "définitivement" : "jusqu’au " + bannedUntil.toLocaleString("fr-FR")) + ".");
    return;
  }

  $("authShell").classList.remove("active");
  $("authShell").classList.add("hidden");
  $("appShell").classList.add("hidden");
  $("adminShell")?.classList.add("hidden");
  $("bottomNav").classList.add("hidden");

  if (profile?.is_admin) {
    adminMode = true;
    $("adminShell")?.classList.remove("hidden");
    await loadAdminDashboard();
    return;
  }

  adminMode = false;
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
  const commentCount = post.discover_post_comments?.length || 0;
  const image = post.image_url || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80";
  const rating = post.rating ? "⭐ " + post.rating + "/5 · " : "";

  return `
    <article class="post-card" data-post-id="${post.id}">
      <div class="post-head">
        <button class="clean-user-btn" onclick="openUserProfile('${author?.id || ''}')">${avatarMarkup(author)}</button>
        <button class="clean-user-btn user-text" onclick="openUserProfile('${author?.id || ''}')">
          <b>${escapeHTML(profileName(author))}</b>
          <div class="post-meta">@${escapeHTML(author?.username || "user")} · ${escapeHTML(post.city || "")}</div>
        </button>
      </div>
      <button class="post-img-btn" onclick="openPostDetail('${post.id}')">
        <img class="post-img" src="${escapeHTML(image)}" alt="${escapeHTML(post.title)}" loading="lazy" />
      </button>
      <div class="post-body">
        <button class="clean-user-btn post-title" onclick="openPostDetail('${post.id}')">${escapeHTML(post.title)}</button>
        <div class="post-meta">${escapeHTML(post.type || "activité")} · ${rating}${escapeHTML(post.address || "")}</div>
        <p>${escapeHTML(post.caption || "")}</p>
        <div class="post-actions">
          <button class="${liked ? "liked" : ""}" onclick="togglePostLike('${post.id}')">${liked ? "♥" : "♡"}</button><b>${likes}</b>
          <button onclick="openComments('${post.id}')">💬</button><b>${commentCount}</b>
          <button onclick="openSharePost('${post.id}', '${escapeHTML(post.title)}')">↗️</button>
          <button onclick="openReportModal('post', '${post.id}')">⚠️</button>
        </div>
        ${commentCount ? `<button class="text-btn" onclick="openComments('${post.id}')">Voir les ${commentCount} commentaire${commentCount > 1 ? "s" : ""}</button>` : ""}
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

async function openComments(postId) {
  activeCommentsPostId = postId;
  openModal("commentsModal");
  await loadComments(postId);
}

async function loadComments(postId) {
  const { data, error } = await supabaseClient
    .from("discover_post_comments")
    .select("id, content, created_at, profiles:user_id(id,first_name,last_name,username,avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(150);
  if (error) {
    console.error(error);
    $("commentsModalList").innerHTML = `<div class="card">Impossible de charger les commentaires.</div>`;
    return;
  }
  $("commentsModalList").innerHTML = (data || []).map(c => `
    <div class="comment-row">
      <button class="clean-user-btn" onclick="openUserProfile('${c.profiles?.id || ""}')">${avatarMarkup(c.profiles)}</button>
      <div>
        <button class="clean-user-btn" onclick="openUserProfile('${c.profiles?.id || ""}')"><b>@${escapeHTML(c.profiles?.username || "user")}</b></button>
        <p>${escapeHTML(c.content)}</p>
      </div>
    </div>
  `).join("") || `<div class="card">Aucun commentaire pour le moment.</div>`;
  $("commentsModalList").scrollTop = $("commentsModalList").scrollHeight;
}

async function submitModalComment(event) {
  event.preventDefault();
  if (!activeCommentsPostId) return;
  const input = $("commentsModalInput");
  const content = input.value.trim();
  if (!content) return;
  const { error } = await supabaseClient.from("discover_post_comments").insert({ post_id: activeCommentsPostId, user_id: currentUser.id, content });
  if (error) return toast("Commentaire impossible.");
  input.value = "";
  await loadComments(activeCommentsPostId);
  if (!$("view-discover").classList.contains("hidden")) await loadDiscoverFeed();
}

function focusComment(postId) { openComments(postId); }
async function addComment(event, postId) { event.preventDefault(); openComments(postId); }

async function openPostDetail(postId) {
  openModal("postDetailModal");
  $("postDetailContent").innerHTML = `<div class="card">Chargement...</div>`;
  try { await supabaseClient.rpc("increment_post_view", { p_post_id: postId }); } catch (_) {}
  const { data: post, error } = await supabaseClient
    .from("discover_posts")
    .select(`*, profiles:author_id(id, first_name, last_name, username, avatar_url, city), discover_post_likes(user_id), discover_post_comments(id)`)
    .eq("id", postId)
    .single();
  if (error) {
    console.error(error);
    $("postDetailContent").innerHTML = `<div class="card">Publication introuvable.</div>`;
    return;
  }
  const author = post.profiles;
  const liked = (post.discover_post_likes || []).some(l => l.user_id === currentUser.id);
  const image = post.image_url || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80";
  const rating = post.rating ? "⭐ " + post.rating + "/5 · " : "";
  $("postDetailContent").innerHTML = `
    <article class="post-detail-card">
      <div class="post-head padded">
        <button class="clean-user-btn" onclick="openUserProfile('${author?.id || ''}')">${avatarMarkup(author)}</button>
        <button class="clean-user-btn user-text" onclick="openUserProfile('${author?.id || ''}')"><b>${escapeHTML(profileName(author))}</b><div class="post-meta">@${escapeHTML(author?.username || "user")} · ${escapeHTML(post.city || "")}</div></button>
      </div>
      <img class="post-detail-img" src="${escapeHTML(image)}" alt="${escapeHTML(post.title)}">
      <div class="post-body padded">
        <h2>${escapeHTML(post.title)}</h2>
        <div class="post-meta">${escapeHTML(post.type || "activité")} · ${rating}${escapeHTML(post.address || "")}</div>
        <p>${escapeHTML(post.caption || "")}</p>
        <div class="post-actions"><button class="${liked ? "liked" : ""}" onclick="togglePostLike('${post.id}')">${liked ? "♥" : "♡"}</button><b>${post.discover_post_likes?.length || 0}</b><button onclick="openComments('${post.id}')">💬</button><b>${post.discover_post_comments?.length || 0}</b><button onclick="openSharePost('${post.id}', '${escapeHTML(post.title)}')">↗️</button><button onclick="openReportModal('post', '${post.id}')">⚠️</button></div>
        <button class="btn dark full-btn" onclick="openComments('${post.id}')">Ouvrir les commentaires</button>
      </div>
    </article>`;
}

async function openUserProfile(userId) {
  if (!userId) return;
  if (userId === currentUser.id) { closeModal("userProfileModal"); setView("profile"); return; }
  openModal("userProfileModal");
  $("userProfileContent").innerHTML = `<div class="card">Chargement...</div>`;
  try { await supabaseClient.from("profile_views").insert({ viewer_id: currentUser.id, profile_id: userId }); } catch (_) {}
  const [{ data: u, error }, { count: followers }, { data: posts }, { data: likes }] = await Promise.all([
    supabaseClient.from("profiles").select("id,first_name,last_name,username,avatar_url,city,bio").eq("id", userId).single(),
    supabaseClient.from("follows").select("id", { count: "exact", head: true }).eq("following_id", userId),
    supabaseClient.from("discover_posts").select("id,title,image_url,view_count").eq("author_id", userId).order("created_at", { ascending: false }),
    supabaseClient.from("discover_posts").select("id, discover_post_likes(id)").eq("author_id", userId)
  ]);
  if (error) { $("userProfileContent").innerHTML = `<div class="card">Profil introuvable.</div>`; return; }
  const totalLikes = (likes || []).reduce((sum, p) => sum + (p.discover_post_likes?.length || 0), 0);
  const totalViews = (posts || []).reduce((sum, p) => sum + (p.view_count || 0), 0);
  $("userProfileContent").innerHTML = `
    <div class="profile-cover public-profile"><div class="profile-avatar">${u.avatar_url ? `<img src="${escapeHTML(u.avatar_url)}" alt="">` : escapeHTML(initials(u))}</div><h2>${escapeHTML(profileName(u))}</h2><p>@${escapeHTML(u.username || "")} · ${escapeHTML(u.city || "")}</p><p>${escapeHTML(u.bio || "")}</p><div class="stats-grid"><div><b>${followers || 0}</b><span>Abonnés</span></div><div><b>${totalLikes}</b><span>Likes</span></div><div><b>${totalViews}</b><span>Vues médias</span></div></div><button class="btn primary" onclick="followUser('${u.id}')">Suivre</button></div>
    <div class="profile-post-grid">${(posts || []).map(p => `<button class="profile-post-btn" onclick="openPostDetail('${p.id}')"><img src="${escapeHTML(p.image_url || "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80")}" alt="${escapeHTML(p.title)}"></button>`).join("") || `<div class="card" style="grid-column:1/-1">Aucune publication.</div>`}</div>`;
}

async function followUser(userId) {
  const { error } = await supabaseClient.from("follows").upsert({ follower_id: currentUser.id, following_id: userId }, { onConflict: "follower_id,following_id" });
  toast(error ? "Impossible de suivre ce profil." : "Profil suivi ✅");
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
  const { data, error } = await supabaseClient.rpc("search_profiles_by_username", { p_query: q });
  if (error) {
    console.error(error);
    resultBox.innerHTML = `<div class="card">Recherche impossible.</div>`;
    toast("Recherche impossible.");
    return;
  }
  resultBox.innerHTML = (data || []).map(u => `
    <div class="card row" style="justify-content:space-between">
      <div class="row">${avatarMarkup(u)}<div><b>${escapeHTML(profileName(u))}</b><div class="post-meta">@${escapeHTML(u.username || "")}</div></div></div>
      <button class="btn dark" data-friend-button="${u.id}" onclick="sendFriendRequest('${u.id}')">Ajouter</button>
    </div>
  `).join("") || `<div class="card">Aucun utilisateur trouvé.</div>`;
}

async function sendFriendRequest(receiverId) {
  const button = document.querySelector(`[data-friend-button="${receiverId}"]`);
  if (button) { button.disabled = true; button.textContent = "Envoi..."; }
  const { error } = await supabaseClient.from("friend_requests").insert({ sender_id: currentUser.id, receiver_id: receiverId, status: "pending" });
  if (error) {
    console.error(error);
    if (button) { button.disabled = false; button.textContent = "Ajouter"; }
    toast("Demande déjà envoyée ou impossible.");
    return;
  }
  if (button) { button.disabled = true; button.textContent = "Envoyée ✅"; button.classList.remove("dark"); button.classList.add("ghost"); }
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

  $("myPostsGrid").innerHTML = (posts || []).map(p => `<button class="profile-post-btn" onclick="openPostDetail('${p.id}')"><img src="${escapeHTML(p.image_url || "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80")}" alt="${escapeHTML(p.title)}"></button>`).join("") || `<div class="card" style="grid-column:1/-1">Aucune publication.</div>`;
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


function openReportModal(targetType = "general", targetId = null) {
  openModal("reportModal");
  $("reportForm").dataset.targetType = targetType;
  $("reportForm").dataset.targetId = targetId || "";
}

async function submitReport(e) {
  e.preventDefault();
  const payload = { reporter_id: currentUser.id, report_type: $("reportType").value, target_type: $("reportForm").dataset.targetType || "general", target_id: $("reportForm").dataset.targetId || null, message: $("reportMessage").value.trim() };
  const { error } = await supabaseClient.from("support_reports").insert(payload);
  if (error) { console.error(error); return toast("Signalement impossible."); }
  $("reportForm").reset(); closeModal("reportModal"); toast("Signalement envoyé. Merci.");
}

function setAdminTab(tab) {
  $$('[data-admin-tab]').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
  $$('.admin-panel').forEach(p => p.classList.add('hidden'));
  $("admin-" + tab)?.classList.remove('hidden');
  if (tab === 'reports') loadAdminReports();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'posts') loadAdminPosts();
  if (tab === 'establishments') loadAdminEstablishments();
}
async function loadAdminDashboard() { setAdminTab('reports'); }
async function loadAdminReports() {
  const { data, error } = await supabaseClient.from('support_reports').select('*, profiles:reporter_id(id,first_name,last_name,username,avatar_url)').order('created_at', { ascending: false }).limit(80);
  if (error) { console.error(error); $("adminReportsList").innerHTML = `<div class="card">Impossible de charger les signalements. Lance le SQL V3.</div>`; return; }
  $("adminReportsList").innerHTML = (data || []).map(r => `<div class="card admin-card"><b>${escapeHTML(r.report_type)} · ${escapeHTML(r.target_type || 'general')}</b><p>${escapeHTML(r.message || '')}</p><small>Par @${escapeHTML(r.profiles?.username || 'user')} · ${new Date(r.created_at).toLocaleString('fr-FR')}</small><div class="hero-actions"><button class="btn light" onclick="adminOpenUser('${r.reporter_id}')">Voir compte</button></div></div>`).join('') || `<div class="card">Aucun signalement.</div>`;
}
async function loadAdminUsers() {
  const q = $("adminUserSearch")?.value.trim() || '';
  let req = supabaseClient.from('profiles').select('id,first_name,last_name,username,avatar_url,city,is_admin,banned_until,banned_permanent,ban_reason,created_at').order('created_at', { ascending: false }).limit(80);
  if (q) req = req.or(`username.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,city.ilike.%${q}%`);
  const { data, error } = await req;
  if (error) { console.error(error); $("adminUsersList").innerHTML = `<div class="card">Impossible de charger les comptes.</div>`; return; }
  $("adminUsersList").innerHTML = (data || []).map(u => `<div class="card row" style="justify-content:space-between"><div class="row">${avatarMarkup(u)}<div><b>${escapeHTML(profileName(u))}</b><div class="post-meta">@${escapeHTML(u.username || '')} · ${escapeHTML(u.city || '')}</div>${u.banned_permanent || u.banned_until ? '<small class="danger-text">Compte banni</small>' : ''}</div></div><button class="btn dark" onclick="adminOpenUser('${u.id}')">Gérer</button></div>`).join('') || `<div class="card">Aucun compte trouvé.</div>`;
}
async function adminOpenUser(userId) {
  openModal('adminUserModal'); $("adminUserDetail").innerHTML = `<div class="card">Chargement...</div>`;
  const { data: u, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
  if (error) { $("adminUserDetail").innerHTML = `<div class="card">Compte introuvable.</div>`; return; }
  $("adminUserDetail").innerHTML = `<div class="card"><div class="row">${avatarMarkup(u)}<div><b>${escapeHTML(profileName(u))}</b><div class="post-meta">@${escapeHTML(u.username || '')}</div><small>ID: ${u.id}</small></div></div><p>${escapeHTML(u.bio || '')}</p><div class="hero-actions"><button class="btn danger" onclick="adminBanUser('${u.id}', 'temporary')">Ban 7 jours</button><button class="btn danger" onclick="adminBanUser('${u.id}', 'permanent')">Ban à vie</button><button class="btn light" onclick="adminUnbanUser('${u.id}')">Annuler ban</button><button class="btn dark" onclick="adminShowMessagesFor('${u.id}')">Voir messages</button></div></div>`;
}
async function adminBanUser(userId, mode) { const reason = prompt('Raison du ban ?') || 'Non précisée'; const { error } = await supabaseClient.rpc('admin_ban_user', { p_user_id: userId, p_mode: mode, p_reason: reason }); toast(error ? 'Ban impossible.' : 'Compte banni.'); if (!error) adminOpenUser(userId); }
async function adminUnbanUser(userId) { const { error } = await supabaseClient.rpc('admin_unban_user', { p_user_id: userId }); toast(error ? 'Déban impossible.' : 'Ban annulé.'); if (!error) adminOpenUser(userId); }
async function loadAdminPosts() {
  const { data, error } = await supabaseClient.from('discover_posts').select('*, profiles:author_id(id,username,first_name,last_name)').order('created_at', { ascending: false }).limit(80);
  if (error) { console.error(error); $("adminPostsList").innerHTML = `<div class="card">Impossible de charger les publications.</div>`; return; }
  $("adminPostsList").innerHTML = (data || []).map(p => `<div class="card admin-card"><div class="row">${p.image_url ? `<img class="admin-thumb" src="${escapeHTML(p.image_url)}" alt="">` : ''}<div><b>${escapeHTML(p.title)}</b><div class="post-meta">@${escapeHTML(p.profiles?.username || 'user')} · ${escapeHTML(p.city || '')}</div></div></div><p>${escapeHTML(p.caption || '')}</p><div class="hero-actions"><button class="btn light" onclick="openPostDetail('${p.id}')">Voir</button><button class="btn danger" onclick="adminDeletePost('${p.id}')">Supprimer</button></div></div>`).join('') || `<div class="card">Aucune publication.</div>`;
}
async function adminDeletePost(postId) { if (!confirm('Supprimer cette publication ?')) return; const { error } = await supabaseClient.from('discover_posts').delete().eq('id', postId); toast(error ? 'Suppression impossible.' : 'Publication supprimée.'); if (!error) loadAdminPosts(); }
async function adminAddEstablishment(e) { e.preventDefault(); const payload = { created_by: currentUser.id, name: $("adminEstName").value.trim(), city: $("adminEstCity").value.trim(), address: $("adminEstAddress").value.trim(), type: $("adminEstType").value, budget_label: $("adminEstBudget").value.trim(), maps_url: $("adminEstMaps").value.trim(), image_url: $("adminEstImage").value.trim(), description: $("adminEstDescription").value.trim() }; const { error } = await supabaseClient.from('establishments').insert(payload); toast(error ? 'Ajout impossible.' : 'Sortie ajoutée.'); if (!error) { $("adminEstablishmentForm").reset(); loadAdminEstablishments(); } }
async function loadAdminEstablishments() { const { data } = await supabaseClient.from('establishments').select('*').order('created_at', { ascending: false }).limit(50); $("adminEstablishmentsList").innerHTML = (data || []).map(e => `<div class="card"><b>${escapeHTML(e.name)}</b><p>${escapeHTML(e.city)} · ${escapeHTML(e.address || '')}</p></div>`).join('') || `<div class="card">Aucune sortie.</div>`; }
function adminShowMessagesFor(userId) { closeModal('adminUserModal'); setAdminTab('messages'); $("adminMessageUserId").value = userId; loadAdminMessagesForUser(); }
async function loadAdminMessagesForUser() { const userId = $("adminMessageUserId").value.trim(); if (!userId) return toast('Entre un ID utilisateur.'); const { data, error } = await supabaseClient.from('conversations').select('*, messages(*), user1:user1_id(username,first_name,last_name), user2:user2_id(username,first_name,last_name)').or(`user1_id.eq.${userId},user2_id.eq.${userId}`).order('created_at', { ascending: false }).limit(30); if (error) { console.error(error); $("adminMessagesList").innerHTML = `<div class="card">Impossible de lire les messages.</div>`; return; } $("adminMessagesList").innerHTML = (data || []).map(c => `<div class="card"><b>${escapeHTML(profileName(c.user1))} ↔ ${escapeHTML(profileName(c.user2))}</b>${(c.messages || []).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).map(m => `<div class="admin-message"><small>${new Date(m.created_at).toLocaleString('fr-FR')}</small><p>${escapeHTML(m.content || '')}</p></div>`).join('')}</div>`).join('') || `<div class="card">Aucune conversation.</div>`; }

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
window.openPostDetail = openPostDetail;
window.openComments = openComments;
window.openUserProfile = openUserProfile;
window.followUser = followUser;
window.openReportModal = openReportModal;
window.adminOpenUser = adminOpenUser;
window.adminBanUser = adminBanUser;
window.adminUnbanUser = adminUnbanUser;
window.adminDeletePost = adminDeletePost;
window.adminShowMessagesFor = adminShowMessagesFor;

init();

/**********************************************************************
 * SortirCeSoir V4 additions
 * - signalements avec réponse admin + fermeture
 * - stats app opens
 * - notifications in-app admin
 * - positions opt-in
 * - suppression commentaires par auteur de post ou admin
 * - suppression sorties admin
 **********************************************************************/
let activeCommentsPostAuthorIdV4 = null;

function bindEvents() {
  $$('[data-view-target]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.viewTarget)));
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));

  $$('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-auth-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('authSubmit').textContent = btn.dataset.authTab === 'signup' ? 'Créer mon compte' : 'Se connecter';
    });
  });

  $('authForm')?.addEventListener('submit', handleAuth);
  $('profileForm')?.addEventListener('submit', saveProfile);
  $('logoutBtn')?.addEventListener('click', logout);
  $('settingsBtn')?.addEventListener('click', async () => { openModal('settingsModal'); await loadMySupportMessages(); });
  $('profileNewPostBtn')?.addEventListener('click', () => openModal('postModal'));
  $('openCreatePostBtn')?.addEventListener('click', () => openModal('postModal'));
  $('postForm')?.addEventListener('submit', createPost);
  $('searchEstablishmentBtn')?.addEventListener('click', searchEstablishments);
  $('establishmentSearch')?.addEventListener('input', debounce(searchEstablishments, 350));
  $('establishmentForm')?.addEventListener('submit', addEstablishment);
  $('refreshFavoritesBtn')?.addEventListener('click', loadFavorites);
  $('openFriendPanelBtn')?.addEventListener('click', () => { openModal('friendsModal'); loadFriendsPanel(); });
  $('searchFriendBtn')?.addEventListener('click', searchFriend);
  $('messageForm')?.addEventListener('submit', sendTextMessage);
  $('chatDeleteBtn')?.addEventListener('click', () => openModal('deleteConversationModal'));
  $('deleteForMeBtn')?.addEventListener('click', () => deleteConversation('me'));
  $('deleteForAllBtn')?.addEventListener('click', () => deleteConversation('all'));
  $('openReportBtn')?.addEventListener('click', () => openReportModal());
  $('shareLocationBtn')?.addEventListener('click', shareMyLocation);
  $('reportForm')?.addEventListener('submit', submitReport);
  $('commentsModalForm')?.addEventListener('submit', submitModalComment);

  $('adminLogoutBtn')?.addEventListener('click', logout);
  $('adminRefreshStatsBtn')?.addEventListener('click', loadAdminStats);
  $('adminRefreshReportsBtn')?.addEventListener('click', loadAdminReports);
  $('adminRefreshPostsBtn')?.addEventListener('click', loadAdminPosts);
  $('adminSearchUsersBtn')?.addEventListener('click', loadAdminUsers);
  $('adminLoadMessagesBtn')?.addEventListener('click', loadAdminMessagesForUser);
  $('adminEstablishmentForm')?.addEventListener('submit', adminAddEstablishment);
  $('adminRefreshLocationsBtn')?.addEventListener('click', loadAdminLocations);
  $('adminNotificationForm')?.addEventListener('submit', adminSendNotification);
  $$('[data-admin-tab]').forEach(btn => btn.addEventListener('click', () => setAdminTab(btn.dataset.adminTab)));

  $$('[data-discover-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-discover-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      discoverFilter = btn.dataset.discoverFilter;
      loadDiscoverFeed();
    });
  });
}

async function renderAuthState() {
  if (!currentUser) {
    adminMode = false;
    $('authShell').classList.add('active');
    $('authShell').classList.remove('hidden');
    $('appShell').classList.add('hidden');
    $('adminShell')?.classList.add('hidden');
    $('bottomNav').classList.add('hidden');
    return;
  }

  await loadProfile();

  const bannedPermanent = !!profile?.banned_permanent;
  const bannedUntil = profile?.banned_until ? new Date(profile.banned_until) : null;
  if (bannedPermanent || (bannedUntil && bannedUntil > new Date())) {
    await supabaseClient.auth.signOut();
    toast('Compte banni ' + (bannedPermanent ? 'définitivement' : 'jusqu’au ' + bannedUntil.toLocaleString('fr-FR')) + '.');
    return;
  }

  await logAppOpen();

  $('authShell').classList.remove('active');
  $('authShell').classList.add('hidden');
  $('appShell').classList.add('hidden');
  $('adminShell')?.classList.add('hidden');
  $('bottomNav').classList.add('hidden');

  if (profile?.is_admin) {
    adminMode = true;
    $('adminShell')?.classList.remove('hidden');
    await loadAdminDashboard();
    return;
  }

  adminMode = false;
  $('appShell').classList.remove('hidden');
  $('bottomNav').classList.remove('hidden');

  await loadHome();
  await loadChatUnreadCount();
  subscribeRealtime();

  if (!profile) {
    toast('Crée ton profil pour continuer.');
    openModal('settingsModal');
    setView('profile');
  }
}

async function logAppOpen() {
  if (!currentUser) return;
  try {
    await supabaseClient.from('app_events').insert({ user_id: currentUser.id, event_type: 'app_open' });
  } catch (_) {}
}

async function loadHome() {
  $('welcome').textContent = profile?.first_name ? `Bonsoir ${profile.first_name} 👋` : 'Bonsoir 👋';

  const [{ data: messages }, { data: notifications }, { data: supportMessages }] = await Promise.all([
    supabaseClient
      .from('messages')
      .select('*, conversations!inner(user1_id,user2_id,deleted_for_all)')
      .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`, { foreignTable: 'conversations' })
      .eq('conversations.deleted_for_all', false)
      .order('created_at', { ascending: false })
      .limit(4),
    supabaseClient
      .from('app_notifications')
      .select('*')
      .or(`recipient_id.is.null,recipient_id.eq.${currentUser.id}`)
      .order('created_at', { ascending: false })
      .limit(4),
    supabaseClient
      .from('support_report_messages')
      .select('*')
      .eq('recipient_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(3)
  ]);

  const blocks = [];
  (notifications || []).forEach(n => blocks.push(`<div class="notif-card card admin-notif"><b>📣 ${escapeHTML(n.title || 'Notification')}</b><span>${escapeHTML(n.body || '')}</span></div>`));
  (supportMessages || []).forEach(m => blocks.push(`<div class="notif-card card support-reply"><b>Réponse support</b><span>${escapeHTML(m.content || '')}</span></div>`));
  (messages || []).forEach(m => blocks.push(`<div class="notif-card card"><b>${m.system_message ? 'Notification' : 'Message'}</b><span>${escapeHTML(m.content || '')}</span></div>`));

  $('homeNotifications').innerHTML = blocks.join('') || `<div class="card">Aucune notification pour le moment.</div>`;
}

async function openComments(postId) {
  activeCommentsPostId = postId;
  activeCommentsPostAuthorIdV4 = null;
  openModal('commentsModal');
  const { data } = await supabaseClient.from('discover_posts').select('author_id').eq('id', postId).single();
  activeCommentsPostAuthorIdV4 = data?.author_id || null;
  await loadComments(postId);
}

async function loadComments(postId) {
  const { data, error } = await supabaseClient
    .from('discover_post_comments')
    .select('id, user_id, content, created_at, profiles:user_id(id,first_name,last_name,username,avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    console.error(error);
    $('commentsModalList').innerHTML = `<div class="card">Impossible de charger les commentaires.</div>`;
    return;
  }
  $('commentsModalList').innerHTML = (data || []).map(c => {
    const canDelete = profile?.is_admin || c.user_id === currentUser.id || activeCommentsPostAuthorIdV4 === currentUser.id;
    return `
      <div class="comment-row">
        <button class="clean-user-btn" onclick="openUserProfile('${c.profiles?.id || ''}')">${avatarMarkup(c.profiles)}</button>
        <div class="comment-content">
          <button class="clean-user-btn" onclick="openUserProfile('${c.profiles?.id || ''}')"><b>@${escapeHTML(c.profiles?.username || 'user')}</b></button>
          <p>${escapeHTML(c.content)}</p>
        </div>
        ${canDelete ? `<button class="icon-btn danger-mini" onclick="deleteDiscoverComment('${c.id}')">🗑️</button>` : ''}
      </div>`;
  }).join('') || `<div class="card">Aucun commentaire pour le moment.</div>`;
  $('commentsModalList').scrollTop = $('commentsModalList').scrollHeight;
}

async function deleteDiscoverComment(commentId) {
  if (!confirm('Supprimer ce commentaire ?')) return;
  const { error } = await supabaseClient.from('discover_post_comments').delete().eq('id', commentId);
  if (error) {
    console.error(error);
    toast('Suppression impossible. Vérifie que le SQL V4 est lancé.');
    return;
  }
  toast('Commentaire supprimé.');
  if (activeCommentsPostId) await loadComments(activeCommentsPostId);
  if (!$('view-discover')?.classList.contains('hidden')) await loadDiscoverFeed();
}

async function loadMySupportMessages() {
  const box = $('mySupportMessages');
  if (!box || !currentUser) return;
  const { data } = await supabaseClient
    .from('support_report_messages')
    .select('content, created_at, support_reports(report_type, status)')
    .eq('recipient_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(5);
  box.innerHTML = (data || []).map(m => `<div class="mini-support-msg"><b>Support</b><span>${escapeHTML(m.content)}</span><small>${new Date(m.created_at).toLocaleString('fr-FR')}</small></div>`).join('');
}

async function shareMyLocation() {
  if (!navigator.geolocation) return toast('La géolocalisation n’est pas disponible.');
  toast('Demande de position...');
  navigator.geolocation.getCurrentPosition(async pos => {
    const payload = {
      user_id: currentUser.id,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabaseClient.from('user_locations').upsert(payload, { onConflict: 'user_id' });
    toast(error ? 'Impossible d’enregistrer la position.' : 'Position partagée avec l’admin.');
  }, () => toast('Position refusée ou indisponible.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function setAdminTab(tab) {
  $$('[data-admin-tab]').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
  $$('.admin-panel').forEach(p => p.classList.add('hidden'));
  $('admin-' + tab)?.classList.remove('hidden');
  if (tab === 'dashboard') loadAdminStats();
  if (tab === 'reports') loadAdminReports();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'posts') loadAdminPosts();
  if (tab === 'establishments') loadAdminEstablishments();
  if (tab === 'locations') loadAdminLocations();
  if (tab === 'notifications') loadAdminNotifications();
}
async function loadAdminDashboard() { setAdminTab('dashboard'); }

async function loadAdminStats() {
  const { data, error } = await supabaseClient.rpc('admin_get_app_stats');
  if (error) {
    console.error(error);
    $('adminStatsGrid').innerHTML = `<div class="card">Impossible de charger les statistiques. Lance le SQL V4.</div>`;
    return;
  }
  const labels = { today: "Aujourd'hui", days_15: '15 jours', days_30: '30 jours' };
  $('adminStatsGrid').innerHTML = (data || []).map(s => {
    const up = Number(s.current_count || 0) >= Number(s.previous_count || 0);
    const diff = Number(s.current_count || 0) - Number(s.previous_count || 0);
    return `<div class="stat-card"><span>${labels[s.metric] || s.metric}</span><b>${s.current_count}</b><small class="${up ? 'trend-up' : 'trend-down'}">${up ? '↗' : '↘'} ${Math.abs(diff)} vs période précédente</small></div>`;
  }).join('');
  await loadAdminRecentNotifications();
}

async function loadAdminRecentNotifications() {
  const { data } = await supabaseClient.from('app_notifications').select('*').order('created_at', { ascending: false }).limit(5);
  const el = $('adminRecentNotifications');
  if (el) el.innerHTML = (data || []).map(n => `<div class="mini-row"><b>${escapeHTML(n.title)}</b><span>${escapeHTML(n.body)}</span></div>`).join('') || `<div class="muted">Aucune notification.</div>`;
}

async function loadAdminReports() {
  const { data, error } = await supabaseClient
    .from('support_reports')
    .select('*, profiles:reporter_id(id,first_name,last_name,username,avatar_url)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) { console.error(error); $('adminReportsList').innerHTML = `<div class="card">Impossible de charger les signalements.</div>`; return; }
  $('adminReportsList').innerHTML = (data || []).map(r => `
    <div class="card admin-card ${r.status === 'closed' ? 'closed-report' : ''}">
      <div class="between"><b>${escapeHTML(r.report_type)} · ${escapeHTML(r.target_type || 'general')}</b><span class="status-pill">${escapeHTML(r.status)}</span></div>
      <p>${escapeHTML(r.message || '')}</p>
      <small>Par @${escapeHTML(r.profiles?.username || 'user')} · ${new Date(r.created_at).toLocaleString('fr-FR')}</small>
      <textarea id="reportReply-${r.id}" placeholder="Réponse admin à envoyer à l’utilisateur..."></textarea>
      <div class="hero-actions">
        <button class="btn light" onclick="adminOpenUser('${r.reporter_id}')">Voir compte</button>
        <button class="btn dark" onclick="adminSendReportMessage('${r.id}', '${r.reporter_id}')">Répondre</button>
        <button class="btn primary" onclick="adminCloseReport('${r.id}')">Fermer</button>
      </div>
    </div>`).join('') || `<div class="card">Aucun signalement.</div>`;
}

async function adminSendReportMessage(reportId, recipientId) {
  const content = $(`reportReply-${reportId}`)?.value.trim();
  if (!content) return toast('Écris une réponse.');
  const { error } = await supabaseClient.rpc('admin_send_report_message', { p_report_id: reportId, p_recipient_id: recipientId, p_content: content });
  toast(error ? 'Message impossible.' : 'Message envoyé.');
  if (!error) loadAdminReports();
}

async function adminCloseReport(reportId) {
  const note = prompt('Note de fermeture facultative :') || '';
  const { error } = await supabaseClient.rpc('admin_close_report', { p_report_id: reportId, p_note: note });
  toast(error ? 'Fermeture impossible.' : 'Signalement fermé.');
  if (!error) loadAdminReports();
}

async function adminSendNotification(e) {
  e.preventDefault();
  const payload = {
    title: $('adminNotifTitle').value.trim(),
    body: $('adminNotifBody').value.trim(),
    recipient_id: $('adminNotifRecipient').value.trim() || null,
    created_by: currentUser.id
  };
  const { error } = await supabaseClient.from('app_notifications').insert(payload);
  toast(error ? 'Notification impossible.' : 'Notification envoyée dans l’app.');
  if (!error) { $('adminNotificationForm').reset(); loadAdminNotifications(); loadAdminRecentNotifications(); }
}

async function loadAdminNotifications() {
  const { data } = await supabaseClient.from('app_notifications').select('*, profiles:recipient_id(username,first_name,last_name)').order('created_at', { ascending: false }).limit(80);
  $('adminNotificationsList').innerHTML = (data || []).map(n => `<div class="card"><b>${escapeHTML(n.title)}</b><p>${escapeHTML(n.body)}</p><small>${n.recipient_id ? 'Pour @' + escapeHTML(n.profiles?.username || n.recipient_id) : 'Broadcast'} · ${new Date(n.created_at).toLocaleString('fr-FR')}</small></div>`).join('') || `<div class="card">Aucune notification.</div>`;
}

async function loadAdminLocations() {
  const { data, error } = await supabaseClient
    .from('user_locations')
    .select('*, profiles:user_id(id,username,first_name,last_name,avatar_url,city)')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) { console.error(error); $('adminLocationsList').innerHTML = `<div class="card">Impossible de charger les positions. Lance le SQL V4.</div>`; return; }
  renderAdminMap(data || []);
  $('adminLocationsList').innerHTML = (data || []).map(l => `<div class="card row" style="justify-content:space-between"><div class="row">${avatarMarkup(l.profiles)}<div><b>${escapeHTML(profileName(l.profiles))}</b><div class="post-meta">@${escapeHTML(l.profiles?.username || '')} · ${Number(l.latitude).toFixed(4)}, ${Number(l.longitude).toFixed(4)}</div><small>${new Date(l.updated_at).toLocaleString('fr-FR')}</small></div></div><button class="btn light" onclick="adminOpenUser('${l.user_id}')">Compte</button></div>`).join('') || `<div class="card">Aucune position partagée.</div>`;
}

function renderAdminMap(locations) {
  const map = $('adminMap');
  if (!map) return;
  if (!locations.length) { map.innerHTML = '<span class="muted">Aucune position partagée.</span>'; return; }
  map.innerHTML = locations.map(l => {
    const x = ((Number(l.longitude) + 180) / 360) * 100;
    const y = ((90 - Number(l.latitude)) / 180) * 100;
    return `<button class="map-dot" style="left:${x}%;top:${y}%" title="${escapeHTML(l.profiles?.username || 'user')}" onclick="adminOpenUser('${l.user_id}')"></button>`;
  }).join('');
}

async function loadAdminEstablishments() {
  const { data, error } = await supabaseClient.from('establishments').select('*').order('created_at', { ascending: false }).limit(80);
  if (error) { console.error(error); $('adminEstablishmentsList').innerHTML = `<div class="card">Impossible de charger les sorties.</div>`; return; }
  $('adminEstablishmentsList').innerHTML = (data || []).map(e => `<div class="card"><b>${escapeHTML(e.name)}</b><p>${escapeHTML(e.city || '')} · ${escapeHTML(e.address || '')}</p><p class="muted">${escapeHTML(e.type || '')} · ${escapeHTML(e.budget_label || '')}</p><div class="hero-actions"><button class="btn danger" onclick="adminDeleteEstablishment('${e.id}')">Supprimer</button></div></div>`).join('') || `<div class="card">Aucune sortie.</div>`;
}

async function adminDeleteEstablishment(id) {
  if (!confirm('Supprimer cette sortie ? Cette action est définitive.')) return;
  const { error } = await supabaseClient.from('establishments').delete().eq('id', id);
  toast(error ? 'Impossible de supprimer la sortie.' : 'Sortie supprimée.');
  if (!error) loadAdminEstablishments();
}

window.deleteDiscoverComment = deleteDiscoverComment;
window.adminSendReportMessage = adminSendReportMessage;
window.adminCloseReport = adminCloseReport;
window.adminDeleteEstablishment = adminDeleteEstablishment;
