export function createTrashHandlers(deps) {
  const {
    state,
    SAFE_ID_RE,
    nowIso,
    fmtDate,
    escapeHtml,
    trashAppsList,
    trashFilesList,
    trashDialog,
    persist,
    render,
    showToast,
    requestJSON,
    applyServerState,
    filteredApps,
  } = deps;

  function moveAppToTrash(appId) {
    if (!SAFE_ID_RE.test(String(appId || ''))) return;
    const idx = state.apps.findIndex((a) => a.id === appId);
    if (idx === -1) return;
    const [app] = state.apps.splice(idx, 1);
    app.deletedAt = nowIso();
    state.trashApps.unshift(app);
    if (state.activeId === appId) {
      state.activeId = filteredApps()[0]?.id || state.apps[0]?.id || null;
    }
    persist();
    render();
    showToast('Application moved to trash.', 'warn');
  }

  function restoreAppFromTrash(appId) {
    if (!SAFE_ID_RE.test(String(appId || ''))) return;
    const idx = state.trashApps.findIndex((a) => a.id === appId);
    if (idx === -1) return;
    const [app] = state.trashApps.splice(idx, 1);
    app.deletedAt = '';
    app.updatedAt = nowIso();
    state.apps.unshift(app);
    state.activeId = app.id;
    persist();
    render();
    renderTrashDialog();
    showToast('Application restored.', 'success');
  }

  async function purgeAppFromTrash(appId) {
    if (!SAFE_ID_RE.test(String(appId || ''))) return;
    const idx = state.trashApps.findIndex((a) => a.id === appId);
    if (idx === -1) return;
    const app = state.trashApps[idx];
    const ok = window.confirm(`Permanently delete \"${app.title}\" at \"${app.company}\"?`);
    if (!ok) return;
    const files = Array.isArray(app.workspaceFiles) ? app.workspaceFiles : [];
    for (const file of files) {
      if (!file?.id) continue;
      try {
        await requestJSON(`/api/files/${encodeURIComponent(file.id)}/purge`, { method: 'DELETE' });
      } catch {}
    }
    state.trashApps.splice(idx, 1);
    persist();
    renderTrashDialog();
    showToast('Permanently deleted.', 'warn');
  }

  async function restoreFileFromTrash(fileId) {
    if (!SAFE_ID_RE.test(String(fileId || ''))) return;
    try {
      const result = await requestJSON(`/api/files/${encodeURIComponent(fileId)}/restore`, {
        method: 'POST',
        body: JSON.stringify({ appId: state.activeId || '' }),
      });
      applyServerState(result.state || {});
      render();
      renderTrashDialog();
      showToast('File restored.', 'success');
    } catch {
      showToast('Could not restore file.', 'error');
    }
  }

  async function purgeFileFromTrash(fileId, fileName) {
    if (!SAFE_ID_RE.test(String(fileId || ''))) return;
    const ok = window.confirm(`Permanently delete file \"${fileName || 'file'}\"?`);
    if (!ok) return;
    try {
      const result = await requestJSON(`/api/files/${encodeURIComponent(fileId)}/purge`, { method: 'DELETE' });
      applyServerState(result.state || {});
      render();
      renderTrashDialog();
      showToast('File permanently deleted.', 'warn');
    } catch (err) {
      const msg = String(err?.message || '').trim();
      if (msg) {
        showToast(msg, 'error');
      } else {
        showToast('Could not purge file.', 'error');
      }
    }
  }

  function openTrashDialog() {
    renderTrashDialog();
    trashDialog.classList.add('open');
  }

  function closeTrashDialog() {
    trashDialog.classList.remove('open');
  }

  function renderTrashDialog() {
    if (!state.trashApps.length) {
      trashAppsList.innerHTML = '<div class="small">No deleted applications.</div>';
    } else {
      trashAppsList.innerHTML = state.trashApps
        .map((app) => `
          <div class="status-history-item">
            <div class="u-grid-gap-xs">
              <strong class="u-strong-sm">${escapeHtml(app.title)}</strong>
              <span class="small">${escapeHtml(app.company)}${app.location ? ` • ${escapeHtml(app.location)}` : ''}</span>
              <span class="small">Deleted ${escapeHtml(fmtDate(app.deletedAt || app.updatedAt || nowIso()))}</span>
            </div>
            <div class="u-flex-gap-xs">
              <button class="btn" data-trash-restore="${escapeHtml(app.id)}">Restore</button>
              <button class="btn" data-trash-purge="${escapeHtml(app.id)}">Delete</button>
            </div>
          </div>
        `)
        .join('');
    }

    trashAppsList.querySelectorAll('[data-trash-restore]').forEach((btn) => {
      btn.addEventListener('click', () => restoreAppFromTrash(btn.dataset.trashRestore));
    });
    trashAppsList.querySelectorAll('[data-trash-purge]').forEach((btn) => {
      btn.addEventListener('click', () => purgeAppFromTrash(btn.dataset.trashPurge));
    });

    if (!state.trashFiles.length) {
      trashFilesList.innerHTML = '<div class="small">No deleted files.</div>';
    } else {
      trashFilesList.innerHTML = state.trashFiles
        .map((file) => `
          <div class="status-history-item">
            <div class="u-grid-gap-xs">
              <strong class="u-strong-sm">${escapeHtml(file.name || 'Untitled file')}</strong>
              <span class="small">From app: ${escapeHtml((state.apps.find((a) => a.id === file.appId) || state.trashApps.find((a) => a.id === file.appId))?.title || 'Original app removed')}</span>
              <span class="small">Deleted ${escapeHtml(fmtDate(file.deletedAt || nowIso()))}</span>
            </div>
            <div class="u-flex-gap-xs">
              <button class="btn" data-trash-file-restore="${escapeHtml(file.id)}">Restore</button>
              <button class="btn" data-trash-file-purge="${escapeHtml(file.id)}" data-trash-file-name="${escapeHtml(file.name || '')}">Delete</button>
            </div>
          </div>
        `)
        .join('');
    }

    trashFilesList.querySelectorAll('[data-trash-file-restore]').forEach((btn) => {
      btn.addEventListener('click', () => restoreFileFromTrash(btn.dataset.trashFileRestore));
    });
    trashFilesList.querySelectorAll('[data-trash-file-purge]').forEach((btn) => {
      btn.addEventListener('click', () => purgeFileFromTrash(btn.dataset.trashFilePurge, btn.dataset.trashFileName || ''));
    });
  }

  return {
    moveAppToTrash,
    restoreAppFromTrash,
    purgeAppFromTrash,
    restoreFileFromTrash,
    purgeFileFromTrash,
    openTrashDialog,
    closeTrashDialog,
    renderTrashDialog,
  };
}
