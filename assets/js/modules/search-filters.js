export function createSearchFilters(deps) {
  const {
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
    render,
  } = deps;

  function uniqueTopValues(values, limit = 6) {
    const seen = new Set();
    const out = [];
    values.forEach((v) => {
      const clean = String(v || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    });
    return out.slice(0, limit);
  }

  function parseSearchQuery(rawQuery) {
    const query = String(rawQuery || '');
    const tokens = {
      company: [],
      title: [],
      location: [],
      notes: [],
      status: [],
      mode: [],
      date: [],
      created: [],
      updated: [],
      status_updated: [],
      applied: [],
      followup: [],
    };
    const tokenRegex = /\b(company|title|location|notes|status|mode|date|created|updated|status_updated|applied|followup):(?:"([^"]*)"|([^\s]+))/gi;
    let match;
    while ((match = tokenRegex.exec(query)) !== null) {
      const field = match[1].toLowerCase();
      const value = (match[2] || match[3] || '').trim().toLowerCase();
      if (!value || !tokens[field]) continue;
      if (['date', 'created', 'updated', 'status_updated', 'applied', 'followup'].includes(field)) {
        if (!/^\d{4}(?:-\d{2}){0,2}$/.test(value)) continue;
      }
      tokens[field].push(value);
    }
    const freeText = query
      .replace(/\b(company|title|location|notes|status|mode|date|created|updated|status_updated|applied|followup):(?:"[^"]*"|[^\s]+)/gi, ' ')
      .toLowerCase();
    const terms = freeText.split(/\s+/).filter(Boolean);
    return { tokens, terms };
  }

  function normalizeIsoDatePrefix(value) {
    const str = String(value || '').trim();
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function datePrefixMatches(sourceDatePrefix, tokenValue) {
    if (!sourceDatePrefix) return false;
    const token = String(tokenValue || '').trim();
    if (!token) return false;
    return sourceDatePrefix.startsWith(token);
  }

  function appendSearchToken(tokenText) {
    const current = searchInput.value.trim();
    searchInput.value = current ? `${current} ${tokenText}` : tokenText;
    searchInput.focus();
    state.search = searchInput.value;
    render();
    renderSearchPopover();
  }

  function openSearchPopover() {
    searchWrap.classList.add('open');
    renderSearchPopover();
  }

  function closeSearchPopover() {
    searchWrap.classList.remove('open');
  }

  function renderSearchPopover() {
    if (!searchPopover || !searchTokenPresets || !searchParsed) return;
    const q = String(state.search || '').trim();
    const parsed = parseSearchQuery(q);
    const quickPresets = [
      'company:',
      'title:',
      'location:',
      'status:applied',
      'status:in_progress',
      'mode:remote',
      'date:',
      'created:',
      'applied:',
    ];
    const dynamicCompany = uniqueTopValues(state.apps.map((a) => a.company)).map((v) => `company:\"${v}\"`);
    const dynamicTitle = uniqueTopValues(state.apps.map((a) => a.title), 3).map((v) => `title:\"${v}\"`);
    const dynamicLocation = uniqueTopValues(state.apps.map((a) => a.location), 3).map((v) => `location:\"${v}\"`);
    const presetItems = [...quickPresets, ...dynamicCompany.slice(0, 3), ...dynamicTitle, ...dynamicLocation].slice(0, 12);

    searchTokenPresets.innerHTML = presetItems
      .map((p) => `<button type="button" class="search-token-btn" data-token="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
      .join('');

    const chips = [];
    Object.entries(parsed.tokens).forEach(([field, values]) => {
      values.forEach((value) => chips.push(`<span class="search-token-chip">${escapeHtml(field)}:${escapeHtml(value)}</span>`));
    });
    parsed.terms.forEach((term) => chips.push(`<span class="search-token-chip">text:${escapeHtml(term)}</span>`));
    const hasTokenChips = Object.values(parsed.tokens).some((arr) => arr.length > 0);
    searchWrap.classList.toggle('has-tokens', hasTokenChips);
    searchParsed.innerHTML = chips.length ? chips.join('') : '';

    searchTokenPresets.querySelectorAll('[data-token]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        appendSearchToken(btn.dataset.token);
      });
    });
  }

  function filteredApps() {
    const parsed = parseSearchQuery(state.search);
    const { tokens, terms } = parsed;
    const base = state.apps.filter((app) => {
      if (state.statusFilter !== 'all' && app.status !== state.statusFilter) return false;
      if (state.modeFilter !== 'all' && app.workMode !== state.modeFilter) return false;
      if (tokens.company.some((v) => !String(app.company || '').toLowerCase().includes(v))) return false;
      if (tokens.title.some((v) => !String(app.title || '').toLowerCase().includes(v))) return false;
      if (tokens.location.some((v) => !String(app.location || '').toLowerCase().includes(v))) return false;
      if (tokens.notes.some((v) => !String(app.note || '').toLowerCase().includes(v))) return false;
      if (tokens.status.some((v) => {
        const statusId = String(app.status || '').toLowerCase();
        const statusLabel = String(getStatusLabel(app.status) || '').toLowerCase();
        return !(statusId.includes(v) || statusLabel.includes(v));
      })) return false;
      if (tokens.mode.some((v) => !String(app.workMode || '').toLowerCase().includes(v))) return false;
      const createdDate = normalizeIsoDatePrefix(app.createdAt);
      const updatedDate = normalizeIsoDatePrefix(app.updatedAt);
      const statusUpdatedDate = normalizeIsoDatePrefix(app.statusUpdatedAt);
      const appliedDate = normalizeIsoDatePrefix(app.appliedAt);
      const followUpDate = normalizeIsoDatePrefix(app.nextFollowUpAt);
      const anyDateFields = [createdDate, updatedDate, statusUpdatedDate, appliedDate, followUpDate].filter(Boolean);
      if (tokens.created.some((v) => !datePrefixMatches(createdDate, v))) return false;
      if (tokens.updated.some((v) => !datePrefixMatches(updatedDate, v))) return false;
      if (tokens.status_updated.some((v) => !datePrefixMatches(statusUpdatedDate, v))) return false;
      if (tokens.applied.some((v) => !datePrefixMatches(appliedDate, v))) return false;
      if (tokens.followup.some((v) => !datePrefixMatches(followUpDate, v))) return false;
      if (tokens.date.some((v) => !anyDateFields.some((d) => datePrefixMatches(d, v)))) return false;
      if (!terms.length) return true;
      const hay = `${app.company} ${app.title} ${app.location} ${app.note}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const sorted = [...base];
    const latestStatusAt = (app) => (Array.isArray(app.statusHistory) && app.statusHistory.length ? app.statusHistory[0].at : app.statusUpdatedAt) || '';
    if (state.sortBy === 'oldest_first') {
      sorted.sort((a, b) => latestStatusAt(a).localeCompare(latestStatusAt(b)));
    } else if (state.sortBy === 'last_modified') {
      sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    } else if (state.sortBy === 'company_asc') {
      sorted.sort((a, b) => a.company.localeCompare(b.company));
    } else if (state.sortBy === 'company_desc') {
      sorted.sort((a, b) => b.company.localeCompare(a.company));
    } else if (state.sortBy === 'title_asc') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (state.sortBy === 'title_desc') {
      sorted.sort((a, b) => b.title.localeCompare(a.title));
    } else {
      sorted.sort((a, b) => latestStatusAt(b).localeCompare(latestStatusAt(a)));
    }
    return sorted;
  }

  function renderFilters() {
    const sortOptions = [
      { value: 'newest_first', label: 'Newest' },
      { value: 'oldest_first', label: 'Oldest' },
      { value: 'last_modified', label: 'Last modified' },
      { value: 'company_asc', label: 'Company A-Z' },
      { value: 'company_desc', label: 'Company Z-A' },
      { value: 'title_asc', label: 'Title A-Z' },
      { value: 'title_desc', label: 'Title Z-A' },
    ];
    sortSelect.innerHTML = sortOptions
      .map((opt) => `<option value="${opt.value}">${escapeHtml(opt.label)}</option>`)
      .join('');
    sortSelect.value = state.sortBy;
    const longestSortLabel = sortOptions.reduce((max, opt) => Math.max(max, opt.label.length), 0);
    const stableWidthCh = Math.min(30, Math.max(20, longestSortLabel + 1));
    sortSelect.style.setProperty('--sort-select-width', `${stableWidthCh}ch`);
    sortSelect.style.width = `${stableWidthCh}ch`;

    statusFilter.innerHTML = [
      '<option value="all">Status: All</option>',
      ...STATUS.map((s) => `<option value="${s.id}">${s.label}</option>`),
    ].join('');
    statusFilter.value = state.statusFilter;

    modeFilter.innerHTML = [
      '<option value="all">Mode: All</option>',
      ...MODES.map((m) => `<option value="${m}">${m}</option>`),
    ].join('');
    modeFilter.value = state.modeFilter;

    const activeCount = [state.statusFilter !== 'all', state.modeFilter !== 'all'].filter(Boolean).length;
    filtersBtn.textContent = activeCount ? `Filters (${activeCount})` : 'Filters';
    filterActions.classList.toggle('is-hidden', !activeCount);

    newMode.innerHTML = MODES.map((m) => `<option value="${m}">${m}</option>`).join('');
    newMode.value = 'Unknown';
  }

  return {
    parseSearchQuery,
    openSearchPopover,
    closeSearchPopover,
    renderSearchPopover,
    filteredApps,
    renderFilters,
  };
}
