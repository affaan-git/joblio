export function createStatusDialogHandlers(deps) {
  const {
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
  } = deps;

  let statusDialogAppId = null;

  function renderStatusHistory(app) {
    normalizeStatusHistory(app);
    if (!app.statusHistory.length) {
      statusHistoryList.innerHTML = '<div class="small">No status history yet.</div>';
      return;
    }
    statusHistoryList.innerHTML = app.statusHistory
      .map((entry) => `
        <div class="status-history-item">
          <span class="pill ${statusClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status))}</span>
          <span class="small">${escapeHtml(fmtDate(entry.at))}</span>
        </div>
      `)
      .join('');
  }

  function setStatusDialogView(view) {
    const showUpdate = view !== 'history';
    statusUpdateView.classList.toggle('is-hidden', !showUpdate);
    statusHistoryView.classList.toggle('is-hidden', showUpdate);
    statusTabUpdate.classList.toggle('active', showUpdate);
    statusTabHistory.classList.toggle('active', !showUpdate);
  }

  function openStatusDialog(appId, view = 'update') {
    if (!SAFE_ID_RE.test(String(appId || ''))) return;
    statusDialogAppId = appId;
    const app = state.apps.find((a) => a.id === appId);
    if (app) renderStatusHistory(app);
    setStatusDialogView(view);
    statusDialog.classList.add('open');
  }

  function closeStatusDialog() {
    statusDialog.classList.remove('open');
    statusDialogAppId = null;
  }

  function getStatusDialogAppId() {
    return statusDialogAppId;
  }

  return {
    renderStatusHistory,
    setStatusDialogView,
    openStatusDialog,
    closeStatusDialog,
    getStatusDialogAppId,
  };
}
