export function getDomRefs() {
  const topBar = document.querySelector('.top-bar');
  const mobileBackBtn = document.getElementById('mobileBackBtn');
  const mobileToolsBtn = document.getElementById('mobileToolsBtn');
  const mobileToolsMenu = document.getElementById('mobileToolsMenu');
  const mobileSortInline = document.getElementById('mobileSortInline');
  const mobileStatusInline = document.getElementById('mobileStatusInline');
  const mobileModeInline = document.getElementById('mobileModeInline');
  const listEl = document.getElementById('list');
  const layoutEl = document.querySelector('.layout');
  const colResizer = document.getElementById('colResizer');
  const detailEl = document.getElementById('detail');
  const countLabel = document.getElementById('countLabel');
  const summaryEl = document.getElementById('pipelineSummary');
  const searchWrap = document.querySelector('.search-wrap');
  const searchInput = document.getElementById('searchInput');
  const searchPopover = document.getElementById('searchPopover');
  const searchTokenPresets = document.getElementById('searchTokenPresets');
  const searchParsed = document.getElementById('searchParsed');
  const sortSelect = document.getElementById('sortSelect');
  const filtersBtn = document.getElementById('filtersBtn');
  const filtersMenu = document.getElementById('filtersMenu');
  const filterActions = document.getElementById('filterActions');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  const statusFilter = document.getElementById('statusFilter');
  const modeFilter = document.getElementById('modeFilter');
  const themeToggle = document.getElementById('themeToggle');
  const dataBtn = document.getElementById('dataBtn');
  const dataMenu = document.getElementById('dataMenu');
  const themeMenuBtn = document.getElementById('themeMenuBtn');
  const backendHealth = document.getElementById('backendHealth');
  const backendHealthText = document.getElementById('backendHealthText');
  const backendBanner = document.getElementById('backendBanner');
  const retryBackendBtn = document.getElementById('retryBackendBtn');
  const trashBtn = document.getElementById('trashBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const revokeSessionsBtn = document.getElementById('revokeSessionsBtn');
  const resumeTemplateBtn = document.getElementById('resumeTemplateBtn');
  const importInput = document.getElementById('importInput');
  const runtimeLayoutStyle = document.getElementById('runtimeLayoutStyle');
  const backendBannerText = backendBanner.querySelector('span');
  const IS_DIRECT_FILE_MODE = window.location.protocol === 'file:';

  const newBtn = document.getElementById('newBtn');
  const mobileNewFab = document.getElementById('mobileNewFab');
  const newDialog = document.getElementById('newDialog');
  const newCancel = document.getElementById('newCancel');
  const newCreate = document.getElementById('newCreate');
  const newPostText = document.getElementById('newPostText');
  const newCompany = document.getElementById('newCompany');
  const newTitle = document.getElementById('newTitle');
  const newLocation = document.getElementById('newLocation');
  const newMode = document.getElementById('newMode');
  const trashDialog = document.getElementById('trashDialog');
  const trashAppsList = document.getElementById('trashAppsList');
  const trashFilesList = document.getElementById('trashFilesList');
  const trashClose = document.getElementById('trashClose');
  const statusDialog = document.getElementById('statusDialog');
  const statusTabUpdate = document.getElementById('statusTabUpdate');
  const statusTabHistory = document.getElementById('statusTabHistory');
  const statusUpdateView = document.getElementById('statusUpdateView');
  const statusHistoryView = document.getElementById('statusHistoryView');
  const statusHistoryList = document.getElementById('statusHistoryList');
  const clearStatusHistoryBtn = document.getElementById('clearStatusHistoryBtn');
  const healthDialog = document.getElementById('healthDialog');
  const healthDialogBody = document.getElementById('healthDialogBody');
  const refreshHealthBtn = document.getElementById('refreshHealthBtn');
  const closeHealthBtn = document.getElementById('closeHealthBtn');
  const mobileThemeBtn = document.getElementById('mobileThemeBtn');
  const mobileHealthBtn = document.getElementById('mobileHealthBtn');
  const mobileTrashBtn = document.getElementById('mobileTrashBtn');
  const mobileExportBtn = document.getElementById('mobileExportBtn');
  const mobileImportBtn = document.getElementById('mobileImportBtn');
  const mobileTemplateBtn = document.getElementById('mobileTemplateBtn');
  const mobileRevokeBtn = document.getElementById('mobileRevokeBtn');
  const toastWrap = document.getElementById('toastWrap');

  return {
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
    themeMenuBtn,
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
  };
}
