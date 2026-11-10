/* The script of the public pages of runward hosted (ADR-0022), served from the closed list (src/http/assets.js) under the
   app's content security policy: script-src 'self', Trusted Types required for every HTML sink. Ported from the
   mini-site's script.js of 2026-11-11; two changes, the rest as written:
   - the language switch never writes a string of HTML: the English of an element marked data-t="<k>" is the content of
     <template id="en-<k>">, parsed with the page by the server's rendering (src/http/site.js); a switch replaces the
     element's children with a copy of that content, or of the French children kept at load. No innerHTML anywhere;
   - the theme is kept under the app's own key (runward-hosted-theme, web/views/theme.js): one choice for the app and
     its public pages, which share an origin. aiguillage.js has already set it before the first paint.

   Page d'accueil de runward hébergé. Vanilla, sans dépendance, aucun appel réseau, aucun cookie.
   1) langue (français par défaut, anglais dans les gabarits en-<k>) et thème (clair par défaut, sombre en option) ;
   2) le moteur du skill ecrans-animes (moteur.js), recopié : apparition au défilement, récit à étapes, séquences.
      Deux ajouts : data-v (vitesse de frappe, en ms par caractère) et un seuil de visibilité adapté aux écrans hauts.
   Mouvement réduit ou JS absent : aucune classe .anim, l'état final reste affiché, fixe. */
(function () {
  var de = document.documentElement;
  var Q = new URLSearchParams(location.search);
  function lire(k) { try { return localStorage.getItem("rw-accueil-" + k); } catch (e) { return null; } }
  function garder(k, v) { try { localStorage.setItem("rw-accueil-" + k, v); } catch (e) { /* confort seulement */ } }

  /* ---- thème : la clé de l'app (web/views/theme.js), un seul choix pour l'app et ses pages publiques */
  var CLE_THEME = "runward-hosted-theme";
  var theme = Q.get("theme") || (function () { try { return localStorage.getItem(CLE_THEME); } catch (e) { return null; } })() || "light";
  function poserTheme() { if (theme === "dark") de.setAttribute("data-theme", "dark"); else de.removeAttribute("data-theme"); }
  poserTheme();
  var bt = document.querySelector("[data-theme-btn]");
  if (bt) bt.addEventListener("click", function () { theme = theme === "dark" ? "light" : "dark"; try { localStorage.setItem(CLE_THEME, theme); } catch (e) { /* confort seulement */ } poserTheme(); });

  /* ---- langue : le français est dans la page, l'anglais dans <template id="en-<k>"> ; on déplace des nœuds, jamais du HTML en texte */
  var lang = Q.get("lang") || lire("lang") || "fr";
  if (lang !== "en") lang = "fr";
  var tr = [].slice.call(document.querySelectorAll("[data-t]"));
  var ar = [].slice.call(document.querySelectorAll("[data-en-aria]"));
  function copie(el) { var f = document.createDocumentFragment(); [].forEach.call(el.childNodes, function (n) { f.appendChild(n.cloneNode(true)); }); return f; }
  var FR = tr.map(copie);
  var EN = tr.map(function (e) { var g = document.getElementById("en-" + e.getAttribute("data-t")); return g && g.content ? g.content : null; });
  ar.forEach(function (e) { e.setAttribute("data-fr-aria", e.getAttribute("aria-label")); });
  var TITRE = { fr: document.title, en: de.getAttribute("data-titre-en") || document.title };
  function poserLangue() {
    de.setAttribute("lang", lang);
    tr.forEach(function (e, i) { var src = lang === "en" ? EN[i] : FR[i]; if (src) e.replaceChildren(document.importNode(src, true)); });
    ar.forEach(function (e) { e.setAttribute("aria-label", e.getAttribute(lang === "en" ? "data-en-aria" : "data-fr-aria")); });
    document.title = TITRE[lang];
    [].forEach.call(document.querySelectorAll("[data-lang]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang)); });
  }
  if (lang === "en") poserLangue();
  [].forEach.call(document.querySelectorAll("[data-lang]"), function (b) {
    b.addEventListener("click", function () { lang = b.getAttribute("data-lang"); garder("lang", lang); poserLangue(); });
  });

  /* ---- la boîte de contact : elle prépare un courriel dans la messagerie du visiteur ; rien ne part vers un serveur.
     <dialog>.showModal() piège le focus, ferme sur Échap et rend le focus à l'élément qui l'a ouverte. */
  var ADRESSE = "thibaultsouris@runward.dev";
  var dlg = document.getElementById("contact");
  if (dlg && typeof dlg.showModal === "function") {
    var form = dlg.querySelector("form"), etat = dlg.querySelector(".dlg-s"), direct = dlg.querySelector("[data-direct]"), titre = dlg.querySelector("#dlg-t");
    var SUJETS = {
      essai: { fr: "Essai de runward sur une application", en: "Trial of runward on an application", tfr: "Demander un essai sur une application", ten: "Ask for a trial on an application", dfr: "Dites-nous qui vous êtes. Votre messagerie s’ouvre avec le courriel prêt à envoyer.", den: "Tell us who you are. Your mail application opens with the message ready to send." },
      stand: { fr: "Rendez-vous au stand runward, 18 et 19 novembre", en: "Meeting at the runward stand, 18 and 19 November", tfr: "Proposer un moment au stand", ten: "Suggest a time at the stand", dfr: "Dites-nous quand vous passez. Votre messagerie s’ouvre avec le courriel prêt à envoyer.", den: "Tell us when you are coming by. Your mail application opens with the message ready to send." }
    };
    var sujet = "essai";
    function L(fr, en) { return lang === "en" ? en : fr; }
    [].forEach.call(document.querySelectorAll("[data-contact]"), function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        sujet = SUJETS[b.getAttribute("data-sujet")] ? b.getAttribute("data-sujet") : "essai";
        titre.textContent = L(SUJETS[sujet].tfr, SUJETS[sujet].ten);
        dlg.querySelector("#dlg-d").textContent = L(SUJETS[sujet].dfr, SUJETS[sujet].den);
        form.elements.nom.removeAttribute("aria-invalid"); form.elements.nom.removeAttribute("aria-describedby");
        etat.textContent = "";
        direct.setAttribute("href", "mailto:" + ADRESSE + "?subject=" + encodeURIComponent(L(SUJETS[sujet].fr, SUJETS[sujet].en)));
        dlg.showModal();
        form.elements.nom.focus();
      });
    });
    dlg.querySelector("[data-fermer]").addEventListener("click", function () { dlg.close(); });
    // focus piégé, strictement : la tabulation tourne dans la boîte, sans passer par la barre du navigateur
    dlg.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = [].filter.call(dlg.querySelectorAll("a[href],button,input,textarea"), function (x) { return !x.disabled && x.offsetParent !== null; });
      var premier = f[0], dernier = f[f.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); }); // un clic sur le voile ferme
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = form.elements, nom = f.nom.value.trim();
      if (!nom) {
        f.nom.setAttribute("aria-invalid", "true"); f.nom.setAttribute("aria-describedby", "dlg-e"); // l'erreur est reliée à son champ
        etat.textContent = L("Indiquez votre nom pour préparer le courriel.", "Enter your name to prepare the email.");
        f.nom.focus(); return;
      }
      f.nom.removeAttribute("aria-invalid"); f.nom.removeAttribute("aria-describedby");
      var lignes = [L("Nom : ", "Name: ") + nom];
      if (f.org.value.trim()) lignes.push(L("Organisation : ", "Organisation: ") + f.org.value.trim());
      if (f.role.value.trim()) lignes.push(L("Rôle : ", "Role: ") + f.role.value.trim());
      if (f.msg.value.trim()) lignes.push("", f.msg.value.trim());
      var url = "mailto:" + ADRESSE + "?subject=" + encodeURIComponent(L(SUJETS[sujet].fr, SUJETS[sujet].en)) + "&body=" + encodeURIComponent(lignes.join("\n"));
      direct.setAttribute("href", url); // le lien de repli porte le même courriel, prêt
      etat.textContent = L("Votre messagerie s’ouvre avec le courriel prêt. Si rien ne s’ouvre, écrivez à " + ADRESSE + ".", "Your mail application opens with the email ready. If nothing opens, write to " + ADRESSE + ".");
      window.location.href = url;
    });
  }
  var imp = document.querySelector("[data-imprimer]");
  if (imp) imp.addEventListener("click", function () { window.print(); });

  /* ---- en-tête : un filet dès que la page a défilé */
  var top = document.querySelector(".top");
  function pose() { if (top) top.classList.toggle("pose", (window.scrollY || 0) > 8); }
  pose(); addEventListener("scroll", pose, { passive: true });

  /* ============================================ le moteur (ecrans-animes) ============================================ */
  var REDUIT = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var IO = "IntersectionObserver" in window;

  /* 1. Apparition au défilement */
  var rv = [].slice.call(document.querySelectorAll(".rv-s"));
  if (IO && !REDUIT) {
    de.classList.add("js");
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    rv.forEach(function (el) { io.observe(el); });
    // Filet : un onglet en arrière-plan ne déclenche pas l'observateur ; rien ne doit rester invisible.
    setTimeout(function () { rv.forEach(function (el) { if (el.getBoundingClientRect().top < innerHeight) el.classList.add("in"); }); }, 1200);
  }

  /* 2. Récit à étapes */
  var steps = [].slice.call(document.querySelectorAll(".step"));
  var sts = [].slice.call(document.querySelectorAll(".screen-stick .st"));
  var rail = document.querySelector(".steps");
  function remplir() {
    if (!rail) return;
    var on = rail.querySelector(".step.on .k") || rail.querySelector(".step.on");
    if (!on) { rail.style.setProperty("--p", "0px"); return; }
    var y = on.getBoundingClientRect().top - rail.getBoundingClientRect().top + on.offsetHeight / 2 - 28;
    rail.style.setProperty("--p", Math.max(0, Math.round(y)) + "px");
  }
  function setStep(n) {
    var avant = true;
    steps.forEach(function (s) {
      var ici = s.getAttribute("data-step") == n;
      if (ici) avant = false;
      s.classList.toggle("on", ici);
      s.classList.toggle("fait", avant && !ici);
    });
    sts.forEach(function (s) { s.classList.toggle("on", s.getAttribute("data-k") == n); });
    var sk = document.querySelector(".screen-stick"); if (sk) sk.setAttribute("data-s", n);
    remplir();
  }
  if (steps.length) {
    de.classList.add("sj");
    setStep(steps[0].getAttribute("data-step"));
    // L'étape en cours est celle dont le milieu est le plus près du milieu de la fenêtre : juste aussi après un saut
    // (ancre, retour en haut de page), là où un observateur d'intersection garderait la dernière étape croisée.
    var courant = null, attente = false;
    function choisir() {
      attente = false;
      var mi = innerHeight / 2, best = null, d = Infinity;
      steps.forEach(function (s) { var r = s.getBoundingClientRect(), e = Math.abs(r.top + r.height / 2 - mi); if (e < d) { d = e; best = s; } });
      var n = best.getAttribute("data-step");
      if (n !== courant) { courant = n; setStep(n); }
    }
    function demander() { if (!attente) { attente = true; (window.requestAnimationFrame || setTimeout)(choisir); } }
    addEventListener("scroll", demander, { passive: true });
    addEventListener("resize", function () { demander(); remplir(); });
    choisir();
  }

  /* 3. Séquences d'écran */
  if (REDUIT || !IO) return;
  [].slice.call(document.querySelectorAll(".ab[data-seq]")).forEach(function (box) {
    var seq = box.getAttribute("data-seq").split(",").map(Number), N = seq.length, hold = +box.getAttribute("data-hold") || 3000;
    var tys = [].slice.call(box.querySelectorAll(".ty"));
    tys.forEach(function (t) { t.setAttribute("data-full", t.textContent); });
    var st = box.closest(".st"), timers = [], running = false, visible = false;
    box.classList.add("anim");
    function later(f, ms) { timers.push(setTimeout(f, ms)); }
    function clear() { timers.forEach(clearTimeout); timers = []; }
    function reset() {
      box.classList.add("rs");
      for (var i = 1; i <= N; i++) box.classList.remove("g" + i);
      tys.forEach(function (t) { t.textContent = ""; });
      void box.offsetWidth; box.classList.remove("rs");
    }
    function fin() { /* l'état final, complet : celui que montre aussi la page sans mouvement */
      box.classList.add("rs");
      for (var i = 1; i <= N; i++) box.classList.add("g" + i);
      tys.forEach(function (t) { t.textContent = t.getAttribute("data-full"); });
      void box.offsetWidth; box.classList.remove("rs");
    }
    function phase(i) {
      box.classList.add("g" + i);
      tys.forEach(function (t) {
        if (t.getAttribute("data-at") != i) return;
        var full = t.getAttribute("data-full"), k = 0, d = +t.getAttribute("data-v") || (full.length < 6 ? 260 : 30);
        (function step() { t.textContent = full.slice(0, ++k); if (k < full.length) later(step, d); })();
      });
    }
    function run() {
      clear(); reset();
      var t = 500;
      for (var i = 1; i <= N; i++) { (function (k) { later(function () { phase(k); }, t); })(i); t += seq[i - 1]; }
      later(run, t + hold);
    }
    function check() {
      var on = visible && (!st || st.classList.contains("on") || getComputedStyle(st).position !== "absolute");
      if (on && !running) { running = true; run(); } else if (!on && running) { running = false; clear(); fin(); }
    }
    // Un écran plus haut que la fenêtre n'atteint jamais 25 % de visibilité : le seuil suit sa hauteur.
    var seuil = Math.max(0.05, Math.min(0.25, (innerHeight * 0.5) / Math.max(1, box.offsetHeight)));
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; check(); }, { threshold: seuil }).observe(box);
    if (st) new MutationObserver(check).observe(st, { attributes: true, attributeFilter: ["class"] });
    fin(); // tant que l'écran n'a pas été vu (ou si l'onglet est gelé), il montre son état final, jamais un écran vide
  });
})();
