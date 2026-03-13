import {
  API_BASE,
  LEFT_WIDTH_KEY,
  STATUS,
  MODES,
  STATUS_IDS,
  SAFE_ID_RE,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MIN,
  LEFT_PANEL_MAX,
  BACKEND_SAVE_ERROR_TOAST_COOLDOWN_MS,
  createInitialState,
} from "./constants.js";
import { getDomRefs } from "./dom.js";
import {
  nowIso,
  nowTimeStr,
  normalizeTimeZone,
  hhmmFromIsoInTimeZone,
  ymdFromIsoInTimeZone,
  fmtDate,
  fmtDateUtc,
  formatTimeShort,
} from "./time.js";
import { escapeHtml } from "./text.js";
import { createSearchFilters } from "./search-filters.js";
import { createTrashHandlers } from "./trash.js";
import { createStatusDialogHandlers } from "./status-dialog.js";

export function initJoblio() {
    const state = createInitialState();
    const {
      topBar,
      mobileBackBtn,
      mobileToolsBtn,
      mobileToolsMenu,
      mobileSortInline,
      mobileStatusInline,
      mobileModeInline,
      listEl,
      layoutEl,
      colResizer,
      detailEl,
      countLabel,
      summaryEl,
      searchWrap,
      searchInput,
      searchPopover,
      searchTokenPresets,
      searchParsed,
      sortSelect,
      filtersBtn,
      filtersMenu,
      filterActions,
      resetFiltersBtn,
      statusFilter,
      modeFilter,
      themeToggle,
      dataBtn,
      dataMenu,
      backendHealth,
      backendHealthText,
      backendBanner,
      retryBackendBtn,
      trashBtn,
      exportBtn,
      importBtn,
      revokeSessionsBtn,
      resumeTemplateBtn,
      importInput,
      runtimeLayoutStyle,
      backendBannerText,
      IS_DIRECT_FILE_MODE,
      newBtn,
      mobileNewFab,
      newDialog,
      newCancel,
      newCreate,
      newPostText,
      newCompany,
      newTitle,
      newLocation,
      newMode,
      trashDialog,
      trashAppsList,
      trashFilesList,
      trashClose,
      statusDialog,
      statusTabUpdate,
      statusTabHistory,
      statusUpdateView,
      statusHistoryView,
      statusHistoryList,
      clearStatusHistoryBtn,
      healthDialog,
      healthDialogBody,
      refreshHealthBtn,
      closeHealthBtn,
      mobileThemeBtn,
      mobileHealthBtn,
      mobileTrashBtn,
      mobileExportBtn,
      mobileImportBtn,
      mobileTemplateBtn,
      mobileRevokeBtn,
      toastWrap,
    } = getDomRefs();

    let saveToastTimer = null;
    let lastSavedToastAt = 0;
    let lastBackendSaveErrorToastAt = 0;
    let csrfToken = "";
    let sessionReady = false;
    let sessionBootstrapInFlight = null;
    let serverTimeZone = "UTC";
    let serverNowIso = "";
    let resumeTemplatesAvailable = false;
    const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";
    const MOBILE_VIEW_KEY = "joblio-mobile-view";
    const savedMobileView = localStorage.getItem(MOBILE_VIEW_KEY);
    if (savedMobileView === "list" || savedMobileView === "detail") {
      state.mobileView = savedMobileView;
    }

    function uid() {
      return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }


    function setLeftPanelWidth(px) {
      if (!runtimeLayoutStyle) return;
      const rounded = Math.round(px);
      runtimeLayoutStyle.textContent = `:root{--left-panel-width:${rounded}px;}`;
    }

    function isMobileLayout() {
      return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
    }

    function syncMobileLayoutMode() {
      if (!layoutEl) return;
      if (!isMobileLayout()) {
        layoutEl.classList.remove("mobile-list", "mobile-detail");
        if (mobileBackBtn) mobileBackBtn.classList.remove("show");
        if (mobileToolsBtn) mobileToolsBtn.classList.remove("show");
        if (mobileNewFab) mobileNewFab.classList.remove("show");
        closeMobileToolsMenu();
        return;
      }
      if (!state.activeId) {
        state.mobileView = "list";
      }
      const mode = state.mobileView === "detail" && state.activeId ? "detail" : "list";
      layoutEl.classList.toggle("mobile-list", mode === "list");
      layoutEl.classList.toggle("mobile-detail", mode === "detail");
      if (mobileBackBtn) {
        mobileBackBtn.classList.toggle("show", mode === "detail");
      }
      if (mobileToolsBtn) {
        mobileToolsBtn.classList.add("show");
      }
      if (mobileNewFab) {
        mobileNewFab.classList.toggle("show", mode === "list");
      }
      localStorage.setItem(MOBILE_VIEW_KEY, mode);
    }

    function openMobileToolsMenu() {
      if (!mobileToolsMenu) return;
      mobileToolsMenu.classList.add("open");
    }

    function closeMobileToolsMenu() {
      if (!mobileToolsMenu) return;
      mobileToolsMenu.classList.remove("open");
    }

    function syncMobileInlineFilters() {
      if (!mobileSortInline || !mobileStatusInline || !mobileModeInline) return;
      mobileSortInline.innerHTML = sortSelect.innerHTML;
      mobileStatusInline.innerHTML = statusFilter.innerHTML;
      mobileModeInline.innerHTML = modeFilter.innerHTML;
      mobileSortInline.value = state.sortBy;
      mobileStatusInline.value = state.statusFilter;
      mobileModeInline.value = state.modeFilter;
    }

    function isOverdueDate(dateStr) {
      if (!dateStr) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(`${dateStr}T00:00:00`);
      if (Number.isNaN(target.getTime())) return false;
      return target < today;
    }


    function normalizeStatusId(v) {
      const candidate = String(v || "");
      return STATUS_IDS.has(candidate) ? candidate : "wishlist";
    }

    function statusClass(v) {
      return `status-${normalizeStatusId(v)}`;
    }

    function normalizeAppId(v) {
      const candidate = String(v || "");
      return SAFE_ID_RE.test(candidate) ? candidate : uid();
    }

    function sanitizeClientApp(app) {
      if (!app || typeof app !== "object") return createApp({ company: "Company", title: "Role" });
      const base = createApp({
        company: String(app.company || "Company"),
        title: String(app.title || "Role"),
        location: String(app.location || ""),
        workMode: MODES.includes(app.workMode) ? app.workMode : "Unknown",
      });
      const merged = { ...base, ...app };
      merged.id = normalizeAppId(merged.id);
      merged.status = normalizeStatusId(merged.status);
      merged.statusHistory = Array.isArray(merged.statusHistory)
        ? merged.statusHistory
          .map((entry) => ({
            status: normalizeStatusId(entry?.status),
            at: String(entry?.at || ""),
          }))
          .slice(0, 200)
        : [];
      merged.workspaceFiles = Array.isArray(merged.workspaceFiles)
        ? merged.workspaceFiles
          .map((f) => {
            if (!f || typeof f !== "object") return null;
            return {
              id: normalizeAppId(f.id),
              name: String(f.name || "Untitled file"),
              size: Number.isFinite(f.size) ? f.size : null,
              type: String(f.type || ""),
            };
          })
          .filter(Boolean)
          .slice(0, 200)
        : [];
      merged.descriptionText = String(merged.descriptionText || merged.intakeText || "");
      if (typeof app.appliedTime !== "string") {
        merged.appliedTime = "";
      }
      if ("intakeText" in merged) delete merged.intakeText;
      return merged;
    }

    function sanitizeClientTrashFile(file) {
      if (!file || typeof file !== "object") return null;
      const id = normalizeAppId(file.id);
      const appId = SAFE_ID_RE.test(String(file.appId || "")) ? String(file.appId) : "";
      return {
        id,
        appId,
        name: String(file.name || ""),
        type: String(file.type || ""),
        size: Number.isFinite(file.size) ? file.size : null,
        deletedAt: String(file.deletedAt || ""),
      };
    }

    function syncThemeLabel() {
      const toDark = state.theme === "light";
      themeToggle.textContent = toDark ? "☾" : "☀";
      themeToggle.title = toDark ? "Switch to dark mode" : "Switch to light mode";
      themeToggle.setAttribute("aria-label", toDark ? "Switch to dark mode" : "Switch to light mode");
      if (mobileThemeBtn) {
        mobileThemeBtn.textContent = toDark ? "Dark mode" : "Light mode";
      }
    }

    function showToast(message, type = "") {
      const toast = document.createElement("div");
      toast.className = `toast ${type}`.trim();
      toast.textContent = message;
      toastWrap.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 3000);
    }

    function scheduleSavedToast() {
      if (saveToastTimer) clearTimeout(saveToastTimer);
      saveToastTimer = setTimeout(() => {
        const now = Date.now();
        if (now - lastSavedToastAt < 2000) return;
        showToast("Saved.", "saved");
        lastSavedToastAt = now;
      }, 700);
    }

    function showBackendSaveErrorToast() {
      const now = Date.now();
      if (now - lastBackendSaveErrorToastAt < BACKEND_SAVE_ERROR_TOAST_COOLDOWN_MS) return;
      showToast("Could not save to backend.", "error");
      lastBackendSaveErrorToastAt = now;
    }

    function createApp({ company, title, location = "", workMode = "Unknown" }) {
      const t = nowIso();
      return {
        id: uid(),
        company,
        title,
        location,
        workMode,
        status: "wishlist",
        statusHistory: [{ status: "wishlist", at: t }],
        statusUpdatedAt: t,
        appliedAt: "",
        appliedTime: "",
        jobUrl: "",
        applicationUrl: "",
        note: "",
        workspaceFiles: [],
        descriptionText: "",
        createdAt: t,
        updatedAt: t,
      };
    }

    async function bootstrapSession() {
      if (IS_DIRECT_FILE_MODE) {
        sessionReady = false;
        return;
      }
      if (sessionBootstrapInFlight) return sessionBootstrapInFlight;
      sessionBootstrapInFlight = (async () => {
        const res = await fetch(`${API_BASE}/api/auth/session`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {}
          const err = new Error(message);
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        csrfToken = String(data?.csrfToken || "");
        serverTimeZone = normalizeTimeZone(data?.serverTimeZone || serverTimeZone);
        serverNowIso = String(data?.at || serverNowIso);
        sessionReady = Boolean(csrfToken);
      })().finally(() => {
        sessionBootstrapInFlight = null;
      });
      return sessionBootstrapInFlight;
    }

    async function requestJSON(path, options = {}) {
      if (IS_DIRECT_FILE_MODE) {
        const err = new Error("Opened directly, start with npm start and open the URL shown in terminal.");
        err.status = 0;
        throw err;
      }
      const retryAuth = Boolean(options._retryAuth);
      const fetchOptions = { ...options };
      delete fetchOptions._retryAuth;
      const method = String(fetchOptions.method || "GET").toUpperCase();
      const headers = {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
      };
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && csrfToken) {
        headers["X-Joblio-CSRF"] = csrfToken;
      }
      const res = await fetch(`${API_BASE}${path}`, {
        ...fetchOptions,
        credentials: "same-origin",
        headers,
      });
      if (!res.ok) {
        if (res.status === 401 && !retryAuth) {
          await bootstrapSession();
          return requestJSON(path, { ...fetchOptions, _retryAuth: true });
        }
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {}
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }

    async function downloadWithAuth(path, filename, retryAuth = false) {
      if (IS_DIRECT_FILE_MODE) {
        const err = new Error("Opened directly, start with npm start and open the URL shown in terminal.");
        err.status = 0;
        throw err;
      }
      if (!sessionReady) {
        await bootstrapSession();
      }
      const res = await fetch(`${API_BASE}${path}`, {
        credentials: "same-origin",
      });
      if (res.status === 401 && !retryAuth) {
        await bootstrapSession();
        return downloadWithAuth(path, filename, true);
      }
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {}
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function basenameFromPath(p) {
      const s = String(p || "");
      const parts = s.split("/");
      return parts[parts.length - 1] || "template";
    }

    let persistTimer = null;
    let persistInFlight = false;
    let persistQueued = false;
    let lastBackendSaveAt = "";

    function setBackendHealth(status, text) {
      backendHealth.classList.remove("connected", "disconnected", "saving");
      if (status) backendHealth.classList.add(status);
      backendHealthText.textContent = text;
      if (status === "connected" && lastBackendSaveAt) {
        backendHealth.title = `Backend connected • Last saved ${formatTimeShort(lastBackendSaveAt)}`;
      } else if (status === "saving") {
        backendHealth.title = "Saving to backend...";
      } else if (status === "disconnected") {
        backendHealth.title = "Backend offline";
      } else {
        backendHealth.title = "Backend status";
      }
      backendBanner.classList.toggle("show", status === "disconnected");
    }

    function closeHealthDialog() {
      healthDialog.classList.remove("open");
    }

    function setResumeTemplateButtonState(enabled, reason = "") {
      resumeTemplatesAvailable = Boolean(enabled);
      resumeTemplateBtn.disabled = !resumeTemplatesAvailable;
      resumeTemplateBtn.setAttribute("aria-disabled", String(!resumeTemplatesAvailable));
      resumeTemplateBtn.title = resumeTemplatesAvailable
        ? "Download configured resume template(s)"
        : (reason || "No resume templates configured");
      if (mobileTemplateBtn) {
        mobileTemplateBtn.disabled = !resumeTemplatesAvailable;
        mobileTemplateBtn.setAttribute("aria-disabled", String(!resumeTemplatesAvailable));
        mobileTemplateBtn.title = resumeTemplatesAvailable
          ? "Download configured resume template(s)"
          : (reason || "No resume templates configured");
      }
    }

    async function refreshResumeTemplateAvailability() {
      if (IS_DIRECT_FILE_MODE) {
        setResumeTemplateButtonState(false, "Templates unavailable in direct file mode");
        return;
      }
      try {
        const payload = await requestJSON("/api/template/resume/list");
        const templates = Array.isArray(payload?.templates) ? payload.templates : [];
        setResumeTemplateButtonState(templates.length > 0);
      } catch (err) {
        if (err?.status === 401) {
          setResumeTemplateButtonState(false, "Unauthorized. Re-authenticate and reload.");
          return;
        }
        setResumeTemplateButtonState(false, "No resume templates configured");
      }
    }

    async function renderHealthDialog() {
      healthDialogBody.innerHTML = `<div class="small">Loading...</div>`;
      try {
        const health = await requestJSON("/api/health?verbose=1");
        serverTimeZone = normalizeTimeZone(health?.serverTimeZone || serverTimeZone);
        serverNowIso = String(health?.at || serverNowIso);
        if (!persistInFlight) {
          setBackendHealth("connected", "Online");
        }
        let integrity = { ok: null, audit: null };
        try {
          integrity = await requestJSON("/api/integrity/verify");
        } catch {}
        const rows = [
          ["Status", health.ok ? "OK" : "Error"],
          ["Server time (UTC)", fmtDateUtc(health.at)],
          ["Last error", health.lastError ? escapeHtml(health.lastError) : "None"],
          ["Audit verified", integrity?.ok === true ? "Yes" : integrity?.ok === false ? "No" : "Unavailable"],
        ];
        if (Number.isFinite(health?.uptimeSec)) rows.push(["Uptime (sec)", String(health.uptimeSec)]);
        if (Number.isFinite(integrity?.audit?.entries)) rows.push(["Audit entries", String(integrity.audit.entries)]);
        if (Number.isFinite(health?.limits?.maxJsonBodyBytes) && health.limits.maxJsonBodyBytes > 0) {
          rows.push(["State max body", `${health.limits.maxJsonBodyBytes} bytes`]);
        }
        if (Number.isFinite(health?.limits?.maxUploadJsonBytes) && health.limits.maxUploadJsonBytes > 0) {
          rows.push(["Upload max body", `${health.limits.maxUploadJsonBytes} bytes`]);
        }
        if (Number.isFinite(health?.limits?.maxFileBytes) && health.limits.maxFileBytes > 0) {
          rows.push(["Max file size", `${health.limits.maxFileBytes} bytes`]);
        }
        if (Number.isFinite(health?.limits?.purgeMinAgeSec) && health.limits.purgeMinAgeSec > 0) {
          rows.push(["Purge min age", `${health.limits.purgeMinAgeSec}s`]);
        }
        healthDialogBody.innerHTML = rows
          .map(([label, value]) => `
            <div class="health-row">
              <span class="small text-muted">${escapeHtml(label)}</span>
              <span class="small">${value}</span>
            </div>
          `)
          .join("");
      } catch (err) {
        if (err?.status !== 401) {
          setBackendHealth("disconnected", "Offline");
        }
        healthDialogBody.innerHTML = `<div class="small">Could not load health report: ${escapeHtml(err?.message || "Unknown error")}</div>`;
      }
    }

    async function openHealthDialog() {
      await renderHealthDialog();
      healthDialog.classList.add("open");
    }

    function currentStatePayload() {
      return {
        version: 1,
        apps: state.apps,
        trashApps: state.trashApps,
        trashFiles: state.trashFiles,
        activeId: state.activeId,
        theme: state.theme,
      };
    }

    function applyServerState(nextState) {
      state.apps = Array.isArray(nextState?.apps) ? nextState.apps.map(sanitizeClientApp) : [];
      state.trashApps = Array.isArray(nextState?.trashApps) ? nextState.trashApps.map(sanitizeClientApp) : [];
      state.trashFiles = Array.isArray(nextState?.trashFiles) ? nextState.trashFiles.map(sanitizeClientTrashFile).filter(Boolean) : [];
      state.activeId = SAFE_ID_RE.test(String(nextState?.activeId || "")) ? String(nextState.activeId) : (state.apps[0]?.id || null);
      state.theme = nextState?.theme === "light" ? "light" : "dark";
      if (state.activeId && !state.apps.some((a) => a.id === state.activeId)) {
        state.activeId = state.apps[0]?.id || null;
      }
      document.body.classList.toggle("theme-light", state.theme === "light");
      syncThemeLabel();
    }

    function persistNow() {
      if (IS_DIRECT_FILE_MODE) {
        setBackendHealth("disconnected", "Offline");
        return;
      }
      if (persistInFlight) {
        persistQueued = true;
        return;
      }
      persistInFlight = true;
      setBackendHealth("saving", "Saving");
      requestJSON("/api/state", {
        method: "PUT",
        body: JSON.stringify({ state: currentStatePayload() }),
      })
        .then(() => {
          lastBackendSaveAt = nowIso();
          setBackendHealth("connected", "Online");
        })
        .catch(() => {
          setBackendHealth("disconnected", "Offline");
          showBackendSaveErrorToast();
        })
        .finally(() => {
          persistInFlight = false;
          if (persistQueued) {
            persistQueued = false;
            persistNow();
          }
        });
    }

    function persist() {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistNow();
      }, 220);
    }

    async function hydrate() {
      if (IS_DIRECT_FILE_MODE) {
        setResumeTemplateButtonState(false, "Templates unavailable in direct file mode");
        setBackendHealth("disconnected", "Offline");
        const savedWidth = Number(localStorage.getItem(LEFT_WIDTH_KEY));
        if (savedWidth && Number.isFinite(savedWidth)) {
          const clamped = Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, savedWidth));
          setLeftPanelWidth(clamped);
        }
        return;
      }
      try {
        const payload = await requestJSON("/api/state");
        applyServerState(payload.state || {});
        await refreshResumeTemplateAvailability();
        setBackendHealth("connected", "Online");
      } catch (err) {
        state.apps = [];
        state.trashApps = [];
        state.trashFiles = [];
        state.activeId = null;
        state.theme = "dark";
        document.body.classList.toggle("theme-light", false);
        syncThemeLabel();
        setResumeTemplateButtonState(false, "No resume templates configured");
        setBackendHealth("disconnected", "Offline");
        if (err?.status === 401) {
          showToast("Unauthorized. Re-authenticate in browser and reload.", "error");
        } else {
          showToast("Backend unavailable. Start server.js", "error");
        }
      }

      const savedWidth = Number(localStorage.getItem(LEFT_WIDTH_KEY));
      if (savedWidth && Number.isFinite(savedWidth)) {
        const clamped = Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, savedWidth));
        setLeftPanelWidth(clamped);
      }
    }

    async function pingBackendHealth() {
      if (IS_DIRECT_FILE_MODE) {
        setBackendHealth("disconnected", "Offline");
        return;
      }
      try {
        const health = await requestJSON("/api/health");
        serverTimeZone = normalizeTimeZone(health?.serverTimeZone || serverTimeZone);
        serverNowIso = String(health?.at || serverNowIso);
        if (!persistInFlight) {
          setBackendHealth("connected", "Online");
        }
      } catch {
        setBackendHealth("disconnected", "Offline");
      }
    }

    function getStatusLabel(id) {
      return STATUS.find((s) => s.id === id)?.label || id;
    }

    function normalizeStatusHistory(app) {
      if (!Array.isArray(app.statusHistory)) {
        app.statusHistory = [];
      }
      app.status = normalizeStatusId(app.status);
      app.statusHistory = app.statusHistory
        .map((entry) => ({
          status: normalizeStatusId(entry?.status),
          at: String(entry?.at || ""),
        }))
        .slice(0, 200);
      if (!app.statusHistory.length && app.status && app.statusUpdatedAt) {
        app.statusHistory = [{ status: app.status, at: app.statusUpdatedAt }];
      }
    }

    const {
      openSearchPopover,
      closeSearchPopover,
      renderSearchPopover,
      filteredApps,
      renderFilters,
    } = createSearchFilters({
      state,
      STATUS,
      MODES,
      searchWrap,
      searchInput,
      searchPopover,
      searchTokenPresets,
      searchParsed,
      sortSelect,
      statusFilter,
      modeFilter,
      filtersBtn,
      filterActions,
      newMode,
      escapeHtml,
      getStatusLabel,
      render: () => render(),
    });

    const {
      moveAppToTrash,
      openTrashDialog,
      closeTrashDialog,
      renderTrashDialog,
    } = createTrashHandlers({
      state,
      SAFE_ID_RE,
      nowIso,
      fmtDate,
      escapeHtml,
      trashAppsList,
      trashFilesList,
      trashDialog,
      persist: () => persist(),
      render: () => render(),
      showToast,
      requestJSON,
      applyServerState,
      filteredApps,
    });

    const {
      renderStatusHistory,
      setStatusDialogView,
      openStatusDialog,
      closeStatusDialog,
      getStatusDialogAppId,
    } = createStatusDialogHandlers({
      state,
      SAFE_ID_RE,
      statusDialog,
      statusTabUpdate,
      statusTabHistory,
      statusUpdateView,
      statusHistoryView,
      statusHistoryList,
      normalizeStatusHistory,
      statusClass,
      getStatusLabel,
      escapeHtml,
      fmtDate,
    });

    function renderList() {
      const apps = filteredApps();
      countLabel.textContent = `Applications (${apps.length})`;
      const appliedCount = state.apps.filter((a) => a.status === "applied").length;
      summaryEl.textContent = `Applied: ${appliedCount}`;

      if (state.activeId && !apps.some((a) => a.id === state.activeId)) {
        state.activeId = apps[0]?.id || null;
      }

      if (!apps.length) {
        listEl.innerHTML = `<div class="list-empty">No applications yet. Click + New to add one.</div>`;
        return;
      }

      listEl.innerHTML = apps
        .map((app) => {
          const active = app.id === state.activeId ? " active" : "";
          const overdue = isOverdueDate(app.nextFollowUpAt);
          return `
            <article class="card${active}" data-id="${escapeHtml(app.id)}">
              <div class="card-main-row">
                <div class="card-title">${escapeHtml(app.title)}</div>
                <div class="card-right-actions">
                  <button class="pill ${statusClass(app.status)} card-status-btn" title="Set or update status" aria-label="Set or update status for ${escapeHtml(app.title)}" data-id="${escapeHtml(app.id)}">${escapeHtml(getStatusLabel(app.status))}</button>
                  <button class="menu-btn card-delete-btn" title="Delete application" aria-label="Delete ${escapeHtml(app.title)} application" data-id="${escapeHtml(app.id)}">×</button>
                </div>
              </div>
              <div class="card-sub">${escapeHtml(app.company)}${app.location ? ` • ${escapeHtml(app.location)}` : ""}</div>
              <div class="card-row">
                <span class="small">Updated ${fmtDate(app.statusUpdatedAt || app.updatedAt)}</span>
                <span class="small ${overdue ? "overdue" : ""}">${overdue ? `Follow-up overdue • ${escapeHtml(app.workMode || "Unknown")}` : escapeHtml(app.workMode || "Unknown")}</span>
              </div>
            </article>
          `;
        })
        .join("");

      listEl.querySelectorAll(".card").forEach((card) => {
        card.addEventListener("click", () => {
          state.activeId = card.dataset.id;
          if (isMobileLayout()) {
            state.mobileView = "detail";
          }
          persist();
          render();
        });
      });

      listEl.querySelectorAll(".card-status-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const appId = btn.dataset.id;
          state.activeId = appId;
          persist();
          openStatusDialog(appId, "update");
        });
      });

      listEl.querySelectorAll(".card-delete-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const appId = btn.dataset.id;
          const app = state.apps.find((a) => a.id === appId);
          if (!app) return;
          const confirmed = window.confirm(`Move "${app.title}" at "${app.company}" to trash?`);
          if (!confirmed) return;
          moveAppToTrash(appId);
        });
      });

      if (state.scrollListToActive && state.activeId) {
        state.scrollListToActive = false;
        requestAnimationFrame(() => {
          const activeCard = listEl.querySelector(`.card[data-id="${CSS.escape(state.activeId)}"]`);
          if (activeCard) {
            activeCard.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        });
      }
    }

    function updateField(app, key, value) {
      app[key] = value;
      app.updatedAt = nowIso();
      persist();
      renderList();
      scheduleSavedToast();
    }

    function setStatus(app, nextStatus, options = {}) {
      const next = normalizeStatusId(nextStatus);
      if (app.status === next) return;
      const t = nowIso();
      normalizeStatusHistory(app);
      app.status = next;
      if (next === "applied") {
        if (!options.preserveAppliedDate && !app.appliedAt) {
          app.appliedAt = ymdFromIsoInTimeZone(t, serverTimeZone) || "";
        }
        if (!app.appliedTime) {
          app.appliedTime = hhmmFromIsoInTimeZone(t, serverTimeZone) || nowTimeStr();
        }
      }
      app.statusUpdatedAt = t;
      app.updatedAt = t;
      app.statusHistory.unshift({ status: next, at: t });
      persist();
      render();
      showToast(`Status updated to ${getStatusLabel(next)}.`, "success");
    }

    function ensureAppWorkspace(app) {
      if (!Array.isArray(app.workspaceFiles)) {
        app.workspaceFiles = [];
      } else {
        app.workspaceFiles = app.workspaceFiles
          .map((f) => {
            if (typeof f === "string") return { id: uid(), name: f, size: null, type: "" };
            if (!f || typeof f !== "object") return null;
            return {
              id: typeof f.id === "string" && f.id ? f.id : uid(),
              name: typeof f.name === "string" ? f.name : "Untitled file",
              size: Number.isFinite(f.size) ? f.size : null,
              type: typeof f.type === "string" ? f.type : "",
            };
          })
          .filter(Boolean);
      }
      if (typeof app.descriptionText !== "string") {
        app.descriptionText = typeof app.intakeText === "string" ? app.intakeText : "";
      }
      if ("intakeText" in app) delete app.intakeText;
      normalizeStatusHistory(app);
    }

    function formatFileSize(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return "Size unknown";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getFileBadge(file) {
      const type = (file.type || "").toLowerCase();
      const name = (file.name || "").toLowerCase();
      if (type.includes("pdf") || name.endsWith(".pdf")) return "PDF";
      if (type.includes("word") || name.endsWith(".doc") || name.endsWith(".docx")) return "DOC";
      if (type.startsWith("image/")) return "IMG";
      if (type.includes("sheet") || name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".csv")) return "SHEET";
      if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return "TEXT";
      return "FILE";
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const base64 = result.includes(",") ? result.split(",")[1] : result;
          resolve(base64);
        };
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(file);
      });
    }

    function renderDetail() {
      const app = state.apps.find((a) => a.id === state.activeId);
      if (!app) {
        detailEl.innerHTML = `<div class=\"detail-empty\">No application selected. Click + New to start tracking.</div>`;
        return;
      }
      ensureAppWorkspace(app);

      detailEl.innerHTML = `
        <div class="detail-grid">
          <section class="section area-core">
            <div class="core-header">
              <button id="coreStatusPill" class="pill ${statusClass(app.status)}" title="Open status history">${escapeHtml(getStatusLabel(app.status))} • ${fmtDate(app.statusUpdatedAt)}</button>
              <div class="core-actions">
                <button id="deleteAppBtn" class="btn">Delete</button>
                <button id="openStatusBtn" class="status-trigger ${statusClass(app.status)}">${app.status ? `Update status: ${escapeHtml(getStatusLabel(app.status))}` : "Set status"}</button>
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="label">Role title</label>
                <input id="fTitle" type="text" value="${escapeHtml(app.title)}" />
              </div>
              <div class="field">
                <label class="label">Company</label>
                <input id="fCompany" type="text" value="${escapeHtml(app.company)}" />
              </div>
              <div class="field">
                <label class="label">Location</label>
                <input id="fLocation" type="text" value="${escapeHtml(app.location || "")}" />
              </div>
              <div class="field">
                <label class="label">Work mode</label>
                <select id="fMode">${MODES.map((m) => `<option ${m === app.workMode ? "selected" : ""}>${m}</option>`).join("")}</select>
              </div>
            </div>
          </section>

          <section class="section area-workspace">
            <div class="section-title">Application workspace</div>
            <p class="workspace-copy">
              Drag and drop files created during your application (resumes, tailored cover letters, notes, screenshots).
              Files stay local to this tracker view.
            </p>
            <div class="drop-zone" id="workspaceDrop">
              <div class="drop-zone-copy">
                <div>Drop files here or click to select</div>
                <div class="drop-zone-subtext">No files added</div>
              </div>
              <div class="drop-zone-copy-spacer" aria-hidden="true"></div>
              <input id="workspaceFileInput" type="file" multiple class="is-hidden" />
              <div class="workspace-files" id="workspaceFiles"></div>
            </div>
          </section>

          <section class="section area-description">
            <div class="section-title">Job description</div>
            <div class="muted-help">Paste the full job posting text to keep with this application.</div>
            <div class="field">
              <label class="label" for="descriptionInput">Description</label>
              <textarea id="descriptionInput" placeholder="Paste job posting text, requirements, compensation details, and links...">${escapeHtml(app.descriptionText || "")}</textarea>
            </div>
          </section>

          <section class="section area-note">
            <div class="section-title">Sticky note</div>
            <textarea id="noteInput" placeholder="Use this space to jot down quick thoughts for ${escapeHtml(app.title)} at ${escapeHtml(app.company)}">${escapeHtml(app.note || "")}</textarea>
          </section>

          <section class="section area-links">
            <div class="section-title">Links & dates</div>
            <div class="grid-2">
              <div class="field">
                <label class="label">Job URL</label>
                <input id="fJobUrl" type="url" value="${escapeHtml(app.jobUrl || "")}" />
              </div>
              <div class="field">
                <label class="label">Application URL</label>
                <input id="fAppUrl" type="url" value="${escapeHtml(app.applicationUrl || "")}" />
              </div>
              <div class="field">
                <label class="label">Applied date</label>
                <input id="fAppliedAt" type="date" value="${escapeHtml(app.appliedAt || "")}" />
              </div>
              <div class="field">
                <label class="label">Applied time</label>
                <input id="fAppliedTime" type="time" value="${escapeHtml(app.appliedTime || "")}" />
              </div>
            </div>
          </section>
        </div>
        <div class="mobile-detail-actions">
          <button id="mobileDetailStatusBtn" class="btn">Update status</button>
          <button id="mobileDetailLinksBtn" class="btn">Open link</button>
          <button id="mobileDetailDeleteBtn" class="btn">Delete</button>
        </div>
      `;

      const bindText = (id, key) => {
        const el = document.getElementById(id);
        el.addEventListener("input", () => updateField(app, key, el.value));
      };
      bindText("fCompany", "company");
      bindText("fTitle", "title");
      bindText("fLocation", "location");
      bindText("fJobUrl", "jobUrl");
      bindText("fAppUrl", "applicationUrl");

      document.getElementById("fMode").addEventListener("change", (e) => updateField(app, "workMode", e.target.value));
      const appliedInput = document.getElementById("fAppliedAt");
      const appliedTimeInput = document.getElementById("fAppliedTime");
      appliedInput.addEventListener("change", (e) => {
        const value = e.target.value;
        if (!value) {
          updateField(app, "appliedAt", "");
          return;
        }
        app.appliedAt = value;
        if (app.status !== "applied") {
          setStatus(app, "applied", { preserveAppliedDate: true });
          return;
        }
        app.updatedAt = nowIso();
        persist();
        renderList();
        scheduleSavedToast();
      });
      appliedTimeInput.addEventListener("change", (e) => {
        const value = e.target.value;
        if (!value) {
          updateField(app, "appliedTime", "");
          return;
        }
        app.appliedTime = value;
        if (!app.appliedAt) {
          app.appliedAt = ymdFromIsoInTimeZone(nowIso(), serverTimeZone) || "";
        }
        if (app.status !== "applied") {
          setStatus(app, "applied", { preserveAppliedDate: true });
          return;
        }
        app.updatedAt = nowIso();
        persist();
        renderList();
        scheduleSavedToast();
      });

      document.getElementById("openStatusBtn").addEventListener("click", () => openStatusDialog(app.id, "update"));
      document.getElementById("coreStatusPill").addEventListener("click", () => openStatusDialog(app.id, "history"));
      document.getElementById("noteInput").addEventListener("input", (e) => updateField(app, "note", e.target.value));

      const drop = document.getElementById("workspaceDrop");
      const fileInput = document.getElementById("workspaceFileInput");
      const filesEl = document.getElementById("workspaceFiles");

      function renderWorkspaceFiles() {
        if (!app.workspaceFiles.length) {
          drop.classList.remove("has-files");
          filesEl.innerHTML = "";
          return;
        }
        drop.classList.add("has-files");
        filesEl.innerHTML = app.workspaceFiles
          .map((file, index) => `
            <article class="file-tile" title="${escapeHtml(file.name)}" data-file-id="${escapeHtml(file.id || "")}">
              <div class="file-tile-head">
                <span class="file-type">${escapeHtml(getFileBadge(file))}</span>
                <button class="file-remove-btn" type="button" data-file-index="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>
              </div>
              <div class="file-name">${escapeHtml(file.name)}</div>
              <div class="file-meta">${escapeHtml(formatFileSize(file.size))}</div>
            </article>
          `)
          .join("");

        filesEl.querySelectorAll(".file-remove-btn").forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const idx = Number(btn.dataset.fileIndex);
            if (!Number.isInteger(idx) || idx < 0 || idx >= app.workspaceFiles.length) return;
            const fileName = app.workspaceFiles[idx]?.name || "this file";
            const confirmed = window.confirm(`Remove "${fileName}" from workspace files?`);
            if (!confirmed) return;
            const fileId = app.workspaceFiles[idx]?.id;
            if (fileId) {
              try {
                const result = await requestJSON(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
                applyServerState(result.state || {});
              } catch {
                showToast(`Could not remove ${fileName}`, "error");
                return;
              }
            }
            render();
            renderTrashDialog();
            scheduleSavedToast();
          });
        });

        filesEl.querySelectorAll(".file-tile").forEach((tile) => {
          tile.addEventListener("click", (e) => {
            if (e.target.closest(".file-remove-btn")) return;
            const fileId = tile.dataset.fileId;
            if (!fileId) return;
            window.location.href = `/api/files/${encodeURIComponent(fileId)}/download`;
          });
        });
      }

      async function addWorkspaceFiles(fileList) {
        const files = Array.from(fileList || []);
        for (const file of files) {
          try {
            const contentBase64 = await fileToBase64(file);
            const payload = await requestJSON("/api/files/upload", {
              method: "POST",
              body: JSON.stringify({
                appId: app.id,
                name: file.name,
                size: Number.isFinite(file.size) ? file.size : null,
                type: file.type || "",
                contentBase64,
              }),
            });
            app.workspaceFiles.push(payload.file);
          } catch {
            showToast(`Could not upload ${file.name}`, "error");
          }
        }
        app.updatedAt = nowIso();
        persist();
        renderWorkspaceFiles();
        scheduleSavedToast();
      }

      renderWorkspaceFiles();
      drop.addEventListener("click", (e) => {
        if (e.target.closest(".workspace-files")) return;
        fileInput.click();
      });
      fileInput.addEventListener("change", async (e) => {
        if (e.target.files) await addWorkspaceFiles(e.target.files);
        fileInput.value = "";
      });

      ["dragenter", "dragover"].forEach((evt) => {
        drop.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.add("highlight");
        });
      });

      ["dragleave", "drop"].forEach((evt) => {
        drop.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.classList.remove("highlight");
        });
      });

      drop.addEventListener("drop", async (e) => {
        if (e.dataTransfer?.files) await addWorkspaceFiles(e.dataTransfer.files);
      });

      const descriptionInput = document.getElementById("descriptionInput");

      if (state.pendingDescriptionFocusId === app.id) {
        state.pendingDescriptionFocusId = null;
        requestAnimationFrame(() => descriptionInput.focus());
      }

      descriptionInput.addEventListener("input", () => {
        app.descriptionText = descriptionInput.value;
        app.updatedAt = nowIso();
        persist();
        scheduleSavedToast();
      });

      document.getElementById("deleteAppBtn").addEventListener("click", () => {
        const confirmed = window.confirm("Move this application to trash?");
        if (!confirmed) return;
        moveAppToTrash(app.id);
      });

      const openBestLink = () => {
        const rawUrl = String(app.applicationUrl || app.jobUrl || "").trim();
        if (!rawUrl) {
          showToast("No link available for this application.", "warn");
          return;
        }
        try {
          const parsed = new URL(rawUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            showToast("Invalid link protocol.", "error");
            return;
          }
          window.open(parsed.toString(), "_blank", "noopener,noreferrer");
        } catch {
          showToast("Invalid link format.", "error");
        }
      };

      const mobileStatusBtn = document.getElementById("mobileDetailStatusBtn");
      const mobileLinksBtn = document.getElementById("mobileDetailLinksBtn");
      const mobileDeleteBtn = document.getElementById("mobileDetailDeleteBtn");
      if (mobileStatusBtn) {
        mobileStatusBtn.addEventListener("click", () => openStatusDialog(app.id, "update"));
      }
      if (mobileLinksBtn) {
        mobileLinksBtn.addEventListener("click", openBestLink);
      }
      if (mobileDeleteBtn) {
        mobileDeleteBtn.addEventListener("click", () => {
          const confirmed = window.confirm("Move this application to trash?");
          if (!confirmed) return;
          moveAppToTrash(app.id);
        });
      }
    }

    function render() {
      renderFilters();
      syncMobileInlineFilters();
      renderList();
      renderDetail();
      syncMobileLayoutMode();
      if (searchWrap.classList.contains("open")) renderSearchPopover();
    }

    function openNewDialog() {
      newCompany.value = "";
      newTitle.value = "";
      newLocation.value = "";
      newMode.value = "Unknown";
      newPostText.value = "";
      newDialog.classList.add("open");
      newTitle.focus();
    }

    function closeNewDialog() {
      newDialog.classList.remove("open");
    }

    async function createFromDialog() {
      const company = newCompany.value.trim();
      const title = newTitle.value.trim();
      const sourceText = newPostText.value.trim();
      if (!company || !title) {
        showToast("Company and role title are required.", "warn");
        return;
      }

      const app = createApp({
        company,
        title,
        location: newLocation.value.trim(),
        workMode: newMode.value,
      });
      app.descriptionText = sourceText;

      state.apps.unshift(app);
      state.activeId = app.id;
      if (isMobileLayout()) {
        state.mobileView = "detail";
      }
      state.pendingDescriptionFocusId = sourceText ? null : app.id;
      persist();
      closeNewDialog();
      render();
      showToast("Application created.", "success");
    }

    function exportTrackerData() {
      const payload = {
        exportedAt: nowIso(),
        version: 1,
        theme: state.theme,
        activeId: state.activeId,
        apps: state.apps,
        trashApps: state.trashApps,
        trashFiles: state.trashFiles,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `joblio-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Tracker exported.", "success");
    }

    function importTrackerData(raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        showToast("Invalid JSON file.", "error");
        return;
      }
      const apps = Array.isArray(parsed?.apps) ? parsed.apps : Array.isArray(parsed) ? parsed : null;
      if (!apps) {
        showToast("No applications found in import.", "error");
        return;
      }
      state.apps = apps.map(sanitizeClientApp);
      state.trashApps = Array.isArray(parsed?.trashApps) ? parsed.trashApps.map(sanitizeClientApp) : [];
      state.trashFiles = Array.isArray(parsed?.trashFiles) ? parsed.trashFiles.map(sanitizeClientTrashFile).filter(Boolean) : [];
      state.activeId = state.apps[0]?.id || null;
      if (parsed?.theme === "light" || parsed?.theme === "dark") {
        state.theme = parsed.theme;
        document.body.classList.toggle("theme-light", state.theme === "light");
        syncThemeLabel();
      }
      persist();
      render();
      showToast("Tracker imported.", "success");
    }

    function setupColumnResizer() {
      if (!colResizer || !layoutEl) return;
      let dragging = false;

      function applyWidth(px) {
        const clamped = Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, px));
        setLeftPanelWidth(clamped);
        localStorage.setItem(LEFT_WIDTH_KEY, String(clamped));
      }

      colResizer.addEventListener("dblclick", () => {
        setLeftPanelWidth(LEFT_PANEL_DEFAULT);
        localStorage.setItem(LEFT_WIDTH_KEY, String(LEFT_PANEL_DEFAULT));
      });

      colResizer.addEventListener("mousedown", (e) => {
        if (window.matchMedia("(max-width: 980px)").matches) return;
        e.preventDefault();
        dragging = true;
        colResizer.classList.add("dragging");
      });

      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const rect = layoutEl.getBoundingClientRect();
        applyWidth(e.clientX - rect.left);
      });

      document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        colResizer.classList.remove("dragging");
      });
    }

    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value;
      render();
      renderSearchPopover();
    });

    searchInput.addEventListener("focus", () => {
      openSearchPopover();
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (searchWrap.classList.contains("open")) {
          e.preventDefault();
          e.stopPropagation();
          closeSearchPopover();
        }
      }
    });

    sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      render();
    });

    statusFilter.addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      filtersMenu.classList.remove("open");
      render();
    });

    modeFilter.addEventListener("change", (e) => {
      state.modeFilter = e.target.value;
      filtersMenu.classList.remove("open");
      render();
    });

    if (mobileSortInline) {
      mobileSortInline.addEventListener("change", (e) => {
        state.sortBy = e.target.value;
        render();
      });
    }
    if (mobileStatusInline) {
      mobileStatusInline.addEventListener("change", (e) => {
        state.statusFilter = e.target.value;
        render();
      });
    }
    if (mobileModeInline) {
      mobileModeInline.addEventListener("change", (e) => {
        state.modeFilter = e.target.value;
        render();
      });
    }

    themeToggle.addEventListener("click", () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      document.body.classList.toggle("theme-light", state.theme === "light");
      syncThemeLabel();
      persist();
    });
    if (mobileThemeBtn) {
      mobileThemeBtn.addEventListener("click", () => {
        state.theme = state.theme === "light" ? "dark" : "light";
        document.body.classList.toggle("theme-light", state.theme === "light");
        syncThemeLabel();
        persist();
      });
    }

    dataBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      filtersMenu.classList.remove("open");
      const willOpen = !dataMenu.classList.contains("open");
      dataMenu.classList.toggle("open");
      if (willOpen) {
        await refreshResumeTemplateAvailability();
      }
    });

    filtersBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dataMenu.classList.remove("open");
      filtersMenu.classList.toggle("open");
    });

    resetFiltersBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.statusFilter = "all";
      state.modeFilter = "all";
      filtersMenu.classList.remove("open");
      render();
      showToast("Filters reset.");
    });

    exportBtn.addEventListener("click", () => {
      dataMenu.classList.remove("open");
      exportTrackerData();
    });
    revokeSessionsBtn.addEventListener("click", async () => {
      dataMenu.classList.remove("open");
      const ok = window.confirm("Revoke all active sessions now?");
      if (!ok) return;
      try {
        await requestJSON("/api/auth/revoke-all", { method: "POST", body: JSON.stringify({}) });
        showToast("All sessions revoked. Reload and sign in again.", "warn");
        setTimeout(() => window.location.reload(), 700);
      } catch {
        showToast("Could not revoke sessions.", "error");
      }
    });
    backendHealth.addEventListener("click", async () => {
      dataMenu.classList.remove("open");
      await openHealthDialog();
    });
    if (mobileHealthBtn) {
      mobileHealthBtn.addEventListener("click", async () => {
        closeMobileToolsMenu();
        await openHealthDialog();
      });
    }
    if (mobileTrashBtn) {
      mobileTrashBtn.addEventListener("click", () => {
        closeMobileToolsMenu();
        openTrashDialog();
      });
    }
    if (mobileExportBtn) {
      mobileExportBtn.addEventListener("click", () => {
        closeMobileToolsMenu();
        exportTrackerData();
      });
    }
    if (mobileImportBtn) {
      mobileImportBtn.addEventListener("click", () => {
        closeMobileToolsMenu();
        importInput.click();
      });
    }
    if (mobileTemplateBtn) {
      mobileTemplateBtn.addEventListener("click", () => {
        closeMobileToolsMenu();
        resumeTemplateBtn.click();
      });
    }
    if (mobileRevokeBtn) {
      mobileRevokeBtn.addEventListener("click", () => {
        closeMobileToolsMenu();
        revokeSessionsBtn.click();
      });
    }
    resumeTemplateBtn.addEventListener("click", async () => {
      dataMenu.classList.remove("open");
      if (!resumeTemplatesAvailable || resumeTemplateBtn.disabled) return;
      try {
        const payload = await requestJSON("/api/template/resume/list");
        const templates = Array.isArray(payload?.templates) ? payload.templates : [];
        if (!templates.length) {
          setResumeTemplateButtonState(false, "No resume templates configured");
          showToast("No resume templates configured.", "warn");
          return;
        }
        setResumeTemplateButtonState(true);
        if (templates.length === 1) {
          const one = templates[0];
          await downloadWithAuth(`/api/template/resume?id=${encodeURIComponent(one.id)}`, basenameFromPath(one.path || one.name));
          showToast("Resume template downloaded.", "success");
          return;
        }
        const lines = templates.map((t, i) => `${i + 1}. ${t.path || t.name}`);
        const answer = window.prompt(`Download templates:\nType a number (1-${templates.length}) or "all"\n\n${lines.join("\n")}`, "all");
        if (!answer) return;
        if (answer.trim().toLowerCase() === "all") {
          for (const t of templates) {
            await downloadWithAuth(`/api/template/resume?id=${encodeURIComponent(t.id)}`, basenameFromPath(t.path || t.name));
          }
          showToast(`Downloaded ${templates.length} templates.`, "success");
          return;
        }
        const idx = Number(answer.trim());
        if (!Number.isInteger(idx) || idx < 1 || idx > templates.length) {
          showToast("Invalid template choice.", "warn");
          return;
        }
        const selected = templates[idx - 1];
        await downloadWithAuth(`/api/template/resume?id=${encodeURIComponent(selected.id)}`, basenameFromPath(selected.path || selected.name));
        showToast("Resume template downloaded.", "success");
      } catch (err) {
        setResumeTemplateButtonState(false, err?.status === 401 ? "Unauthorized. Re-authenticate and reload." : "No resume templates configured");
        showToast(err?.status === 401 ? "Unauthorized. Re-authenticate in browser and reload." : "Could not download template.", "error");
      }
    });
    importBtn.addEventListener("click", () => {
      dataMenu.classList.remove("open");
      importInput.click();
    });
    importInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const raw = await file.text();
      importTrackerData(raw);
      importInput.value = "";
    });

    retryBackendBtn.addEventListener("click", async () => {
      await hydrate();
      render();
      pingBackendHealth();
    });

    newBtn.addEventListener("click", openNewDialog);
    if (mobileNewFab) {
      mobileNewFab.addEventListener("click", openNewDialog);
    }
    newCancel.addEventListener("click", closeNewDialog);
    newCreate.addEventListener("click", createFromDialog);
    trashBtn.addEventListener("click", openTrashDialog);
    trashClose.addEventListener("click", closeTrashDialog);

    newDialog.addEventListener("click", (e) => {
      if (e.target === newDialog) closeNewDialog();
    });
    trashDialog.addEventListener("click", (e) => {
      if (e.target === trashDialog) closeTrashDialog();
    });
    healthDialog.addEventListener("click", (e) => {
      if (e.target === healthDialog) closeHealthDialog();
    });
    refreshHealthBtn.addEventListener("click", renderHealthDialog);
    closeHealthBtn.addEventListener("click", closeHealthDialog);
    if (mobileToolsBtn) {
      mobileToolsBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const willOpen = !mobileToolsMenu?.classList.contains("open");
        closeMobileToolsMenu();
        if (willOpen) {
          await refreshResumeTemplateAvailability();
          openMobileToolsMenu();
        }
      });
    }

    newDialog.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        createFromDialog();
      }
    });

    statusTabUpdate.addEventListener("click", () => setStatusDialogView("update"));
    statusTabHistory.addEventListener("click", () => {
      const app = state.apps.find((a) => a.id === getStatusDialogAppId());
      if (app) renderStatusHistory(app);
      setStatusDialogView("history");
    });

    clearStatusHistoryBtn.addEventListener("click", () => {
      const app = state.apps.find((a) => a.id === getStatusDialogAppId());
      if (!app) return;
      const ok = window.confirm("Clear this application's status history?");
      if (!ok) return;
      const at = app.statusUpdatedAt || nowIso();
      app.statusHistory = [{ status: app.status, at }];
      app.updatedAt = nowIso();
      persist();
      renderStatusHistory(app);
      renderList();
      showToast("Status history cleared.", "warn");
    });

    statusDialog.addEventListener("click", (e) => {
      if (e.target === statusDialog) {
        closeStatusDialog();
        return;
      }
      const actionBtn = e.target.closest("[data-status-action]");
      const action = actionBtn?.dataset?.statusAction;
      if (!action) return;
      if (action === "cancel") {
        closeStatusDialog();
        return;
      }
      if (!STATUS_IDS.has(action)) return;
      const app = state.apps.find((a) => a.id === getStatusDialogAppId());
      if (!app) {
        closeStatusDialog();
        return;
      }
      setStatus(app, action);
      closeStatusDialog();
    });

    function isTextEntryTarget(target) {
      if (!target) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    document.addEventListener("pointerdown", (e) => {
      const inData = e.target.closest("#dataBtn, #dataMenu");
      const inFilters = e.target.closest("#filtersBtn, #filtersMenu");
      const inMobileTools = e.target.closest("#mobileToolsBtn, #mobileToolsMenu");
      if (!inData) dataMenu.classList.remove("open");
      if (!inFilters) filtersMenu.classList.remove("open");
      if (!inMobileTools) closeMobileToolsMenu();
      if (!e.target.closest(".search-wrap")) closeSearchPopover();
    }, true);

    topBar.addEventListener("click", (e) => {
      const inData = e.target.closest("#dataBtn, #dataMenu");
      const inFilters = e.target.closest("#filtersBtn, #filtersMenu");
      if (!inData) dataMenu.classList.remove("open");
      if (!inFilters) filtersMenu.classList.remove("open");
    });

    document.addEventListener("keydown", (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === "/" && !isTextEntryTarget(e.target)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        openSearchPopover();
        return;
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "n" || e.key === "N") && !isTextEntryTarget(e.target)) {
        e.preventDefault();
        openNewDialog();
        return;
      }

      if (e.key === "Escape") {
        if (document.activeElement === searchInput) return;
        dataMenu.classList.remove("open");
        filtersMenu.classList.remove("open");
        closeSearchPopover();
        closeStatusDialog();
        closeTrashDialog();
        closeNewDialog();
        closeHealthDialog();
        closeMobileToolsMenu();
      }
    });

    setResumeTemplateButtonState(false, "Checking template availability...");

    (async () => {
      if (IS_DIRECT_FILE_MODE) {
        backendBannerText.textContent = "Backend is offline. Changes cannot be saved. Opened directly, start with npm start and open the URL shown in terminal.";
        backendBanner.classList.add("show");
      }
      try {
        await bootstrapSession();
      } catch {}
      await hydrate();
      setupColumnResizer();
      window.addEventListener("resize", () => {
        syncMobileLayoutMode();
      });
      render();
      pingBackendHealth();
      if (!IS_DIRECT_FILE_MODE) {
        setInterval(pingBackendHealth, 30000);
      }
    })();

    if (mobileBackBtn) {
      mobileBackBtn.addEventListener("click", () => {
        state.mobileView = "list";
        state.scrollListToActive = true;
        syncMobileLayoutMode();
        renderList();
      });
    }

    let touchStartX = 0;
    let touchStartY = 0;
    document.addEventListener("touchstart", (e) => {
      if (!isMobileLayout()) return;
      const touch = e.touches?.[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!isMobileLayout()) return;
      if (state.mobileView !== "detail") return;
      const touch = e.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - touchStartX;
      const dy = Math.abs(touch.clientY - touchStartY);
      if (dx > 90 && dy < 60) {
        state.mobileView = "list";
        state.scrollListToActive = true;
        syncMobileLayoutMode();
        renderList();
      }
    }, { passive: true });

}
