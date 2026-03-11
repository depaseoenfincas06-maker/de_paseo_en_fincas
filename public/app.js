const routeToTab = {
  '/': 'simulator',
  '/simulator': 'simulator',
  '/monitoring': 'monitoring',
  '/settings': 'settings',
};

const tabToRoute = {
  simulator: '/simulator',
  monitoring: '/monitoring',
  settings: '/settings',
};

const sendQueueByConversation = new Map();

const appState = {
  activeTab: routeToTab[window.location.pathname] || 'simulator',
  timezone: 'America/Bogota',
  workflow: null,
  settings: null,
  settingsLoaded: false,
  settingsDirty: false,
  settingsSaving: false,
  settingsLoadPromise: null,
  simulator: {
    conversations: [],
    activeConversationId: null,
    filter: '',
    pendingByConversation: {},
    pollingByConversation: {},
    nextLocalSequence: 1,
    loaded: false,
  },
  monitoring: {
    filters: {
      search: '',
      timeframe: 'all',
      agent: 'all',
      waitingFor: 'all',
      converted: 'all',
      followOn: 'all',
    },
    summary: null,
    conversations: [],
    selectedConversationId: null,
    selectedConversation: null,
    businessHours: null,
    settingsStatus: null,
    loaded: false,
    loading: false,
  },
};

const elements = {
  tabs: Array.from(document.querySelectorAll('.workspace-tab')),
  views: Array.from(document.querySelectorAll('.view-panel')),
  globalBotBadge: document.getElementById('global-bot-badge'),
  globalFollowupBadge: document.getElementById('global-followup-badge'),
  globalOwnerOverrideBadge: document.getElementById('global-owner-override-badge'),
  globalSelectionNotificationBadge: document.getElementById('global-selection-notification-badge'),
  simulator: {
    list: document.getElementById('conversation-list'),
    thread: document.getElementById('message-thread'),
    inspector: document.getElementById('inspector-body'),
    title: document.getElementById('chat-title'),
    avatar: document.getElementById('chat-avatar'),
    stage: document.getElementById('chat-stage'),
    status: document.getElementById('chat-status'),
    form: document.getElementById('message-form'),
    input: document.getElementById('message-input'),
    send: document.getElementById('send-btn'),
    search: document.getElementById('search-input'),
    create: document.getElementById('new-conversation-btn'),
    template: document.getElementById('conversation-item-template'),
    workflowBadge: document.getElementById('workflow-badge'),
  },
  monitoring: {
    search: document.getElementById('monitor-search'),
    timeframe: document.getElementById('monitor-timeframe'),
    agent: document.getElementById('monitor-agent'),
    waiting: document.getElementById('monitor-waiting'),
    converted: document.getElementById('monitor-converted'),
    followOn: document.getElementById('monitor-follow-on'),
    summary: document.getElementById('monitor-summary'),
    tableBody: document.getElementById('monitor-table-body'),
    count: document.getElementById('monitor-count'),
    detailTitle: document.getElementById('monitor-detail-title'),
    detailBody: document.getElementById('monitor-detail-body'),
    hours: document.getElementById('monitoring-hours'),
  },
  settings: {
    form: document.getElementById('settings-form'),
    save: document.getElementById('settings-save-btn'),
    saveState: document.getElementById('settings-save-state'),
    alert: document.getElementById('settings-alert'),
    tonePreset: document.getElementById('settings-tone-preset'),
    toneExtra: document.getElementById('settings-tone-extra'),
    initialMessage: document.getElementById('settings-initial-message'),
    handoffMessage: document.getElementById('settings-handoff-message'),
    ownerOverride: document.getElementById('settings-owner-override'),
    globalBotEnabled: document.getElementById('settings-global-bot'),
    followupEnabled: document.getElementById('settings-followup-enabled'),
    followupStart: document.getElementById('settings-followup-start'),
    followupEnd: document.getElementById('settings-followup-end'),
    followupQualifying: document.getElementById('settings-followup-qualifying'),
    followupOffering: document.getElementById('settings-followup-offering'),
    followupVerifying: document.getElementById('settings-followup-verifying'),
    inventoryEnabled: document.getElementById('settings-inventory-enabled'),
    inventoryDoc: document.getElementById('settings-inventory-doc'),
    inventoryTab: document.getElementById('settings-inventory-tab'),
    coverageZones: document.getElementById('settings-coverage-zones'),
    maxProperties: document.getElementById('settings-max-properties'),
    selectionEnabled: document.getElementById('settings-selection-enabled'),
    selectionRecipients: document.getElementById('settings-selection-recipients'),
    selectionTemplateName: document.getElementById('settings-selection-template-name'),
    selectionTemplateLanguage: document.getElementById('settings-selection-template-language'),
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compactText(value) {
  return String(value ?? '').trim();
}

function enqueueConversationSend(conversationId, task) {
  const previous = sendQueueByConversation.get(conversationId) || Promise.resolve();
  const next = previous.catch(() => null).then(task);
  const settled = next.catch(() => null);

  sendQueueByConversation.set(
    conversationId,
    settled.finally(() => {
      if (sendQueueByConversation.get(conversationId) === settled) {
        sendQueueByConversation.delete(conversationId);
      }
    }),
  );

  return next;
}

function formatDateTime(value, options = {}) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: appState.timezone,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: options.long ? 'short' : 'short',
    ...(options.includeYear ? { year: 'numeric' } : {}),
  }).format(new Date(value));
}

function formatDateTimeLong(value) {
  if (!value) return 'Sin dato';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: appState.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatCountdown(value) {
  if (value == null) return 'Sin follow on';
  const abs = Math.abs(value);
  const minutes = Math.round(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const label = hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
  return value <= 0 ? `Vencido por ${label}` : `Faltan ${label}`;
}

function stageLabel(value) {
  return value || 'NEW';
}

function initialsFromTitle(title) {
  return String(title || 'AG')
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0] || '')
    .join('')
    .toUpperCase();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || 'Request failed');
  }
  return json;
}

function updateGlobalHeader() {
  const settings = appState.settings;

  if (!settings) {
    elements.globalBotBadge.textContent = 'Cargando settings';
    elements.globalFollowupBadge.textContent = 'Follow-on ...';
    elements.globalOwnerOverrideBadge.textContent = 'Propietario real';
    return;
  }

  elements.globalBotBadge.textContent = settings.globalBotEnabled ? 'Bot activo' : 'Bot global pausado';
  elements.globalBotBadge.classList.toggle('badge-warn', settings.globalBotEnabled === false);

  elements.globalFollowupBadge.textContent = settings.followupEnabled
    ? `Follow-on ${settings.followupWindowStart}-${settings.followupWindowEnd}`
    : 'Follow-on desactivado';
  elements.globalFollowupBadge.classList.toggle('badge-warn', settings.followupEnabled === false);

  elements.globalOwnerOverrideBadge.textContent = settings.ownerContactOverride
    ? `Override propietario · ${settings.ownerContactOverride}`
    : 'Propietario real';
  elements.globalOwnerOverrideBadge.classList.toggle('badge-warn', Boolean(settings.ownerContactOverride));

  elements.globalSelectionNotificationBadge.textContent = settings.selectionNotificationEnabled
    ? 'Notif. selección activa'
    : 'Notif. selección apagada';
  elements.globalSelectionNotificationBadge.classList.toggle(
    'badge-warn',
    settings.selectionNotificationEnabled === false,
  );
}

function setActiveTab(tab, { pushState = true } = {}) {
  appState.activeTab = tab;

  for (const element of elements.tabs) {
    element.classList.toggle('workspace-tab--active', element.dataset.tab === tab);
  }

  for (const view of elements.views) {
    view.classList.toggle('view-panel--active', view.dataset.view === tab);
  }

  if (pushState) {
    window.history.pushState({}, '', tabToRoute[tab] || '/simulator');
  }

  if (tab === 'monitoring' && !appState.monitoring.loaded) {
    void loadMonitoringData();
  }

  if (tab === 'settings' && !appState.settingsLoaded) {
    void loadSettings();
  }
}

function renderSettingsState(label, mode = 'neutral') {
  elements.settings.saveState.textContent = label;
  elements.settings.saveState.classList.toggle('badge-warn', mode === 'warn');
  elements.settings.saveState.classList.toggle('badge-success', mode === 'success');
}

function showSettingsAlert(message, mode = 'info') {
  if (!message) {
    elements.settings.alert.hidden = true;
    elements.settings.alert.textContent = '';
    elements.settings.alert.className = 'settings-alert';
    return;
  }

  elements.settings.alert.hidden = false;
  elements.settings.alert.textContent = message;
  elements.settings.alert.className = `settings-alert settings-alert--${mode}`;
}

function applySettingsToForm(settings) {
  elements.settings.tonePreset.value = settings.tonePreset;
  elements.settings.toneExtra.value = settings.toneGuidelinesExtra || '';
  elements.settings.initialMessage.value = settings.initialMessageTemplate || '';
  elements.settings.handoffMessage.value = settings.handoffMessage || '';
  elements.settings.ownerOverride.value = settings.ownerContactOverride || '';
  elements.settings.globalBotEnabled.checked = settings.globalBotEnabled === true;
  elements.settings.followupEnabled.checked = settings.followupEnabled === true;
  elements.settings.followupStart.value = settings.followupWindowStart || '08:00';
  elements.settings.followupEnd.value = settings.followupWindowEnd || '22:00';
  elements.settings.followupQualifying.value = settings.followupMessageQualifying || '';
  elements.settings.followupOffering.value = settings.followupMessageOffering || '';
  elements.settings.followupVerifying.value = settings.followupMessageVerifyingAvailability || '';
  elements.settings.inventoryEnabled.checked = settings.inventorySheetEnabled === true;
  elements.settings.inventoryDoc.value = settings.inventorySheetDocumentId || '';
  elements.settings.inventoryTab.value = settings.inventorySheetTabName || '';
  elements.settings.coverageZones.value = settings.coverageZonesText || '';
  elements.settings.maxProperties.value = String(settings.maxPropertiesToShow || 3);
  elements.settings.selectionEnabled.checked = settings.selectionNotificationEnabled === true;
  elements.settings.selectionRecipients.value = settings.selectionNotificationRecipients || '';
  elements.settings.selectionTemplateName.value = settings.selectionNotificationTemplateName || '';
  elements.settings.selectionTemplateLanguage.value = settings.selectionNotificationTemplateLanguage || '';
}

function readSettingsForm() {
  return {
    tonePreset: elements.settings.tonePreset.value,
    toneGuidelinesExtra: elements.settings.toneExtra.value,
    initialMessageTemplate: elements.settings.initialMessage.value,
    handoffMessage: elements.settings.handoffMessage.value,
    ownerContactOverride: elements.settings.ownerOverride.value,
    globalBotEnabled: elements.settings.globalBotEnabled.checked,
    followupEnabled: elements.settings.followupEnabled.checked,
    followupWindowStart: elements.settings.followupStart.value,
    followupWindowEnd: elements.settings.followupEnd.value,
    followupMessageQualifying: elements.settings.followupQualifying.value,
    followupMessageOffering: elements.settings.followupOffering.value,
    followupMessageVerifyingAvailability: elements.settings.followupVerifying.value,
    inventorySheetEnabled: elements.settings.inventoryEnabled.checked,
    inventorySheetDocumentId: elements.settings.inventoryDoc.value,
    inventorySheetTabName: elements.settings.inventoryTab.value,
    coverageZonesText: elements.settings.coverageZones.value,
    maxPropertiesToShow: Number(elements.settings.maxProperties.value || 3),
    selectionNotificationEnabled: elements.settings.selectionEnabled.checked,
    selectionNotificationRecipients: elements.settings.selectionRecipients.value,
    selectionNotificationTemplateName: elements.settings.selectionTemplateName.value,
    selectionNotificationTemplateLanguage: elements.settings.selectionTemplateLanguage.value,
  };
}

async function loadSettings({ silent = false } = {}) {
  if (!silent && appState.settingsLoadPromise) return appState.settingsLoadPromise;

  const request = api('/api/settings')
    .then((payload) => {
      appState.timezone = payload.timezone || appState.timezone;
      appState.settings = payload.settings;
      appState.settingsLoaded = true;
      appState.settingsDirty = false;
      applySettingsToForm(payload.settings);
      updateGlobalHeader();
      renderSettingsState('Configuración cargada', 'success');
      if (payload.settings.ownerContactOverride) {
        showSettingsAlert(
          'El override de propietario está activo. El agente devolverá este número en vez del contacto real.',
          'warn',
        );
      } else if (
        payload.settings.selectionNotificationEnabled &&
        payload.settings.selectionNotificationRecipients
      ) {
        showSettingsAlert(
          'La notificación de selección está activa y enviará alertas cuando un cliente elija una finca distinta.',
          'info',
        );
      } else {
        showSettingsAlert(
          'Los cambios aplican a nuevas ejecuciones y nuevos follow-ons. Los follow-ons ya programados no se reescriben.',
          'info',
        );
      }
      return payload.settings;
    })
    .catch((error) => {
      renderSettingsState('Error cargando settings', 'warn');
      showSettingsAlert(error.message, 'error');
      throw error;
    })
    .finally(() => {
      appState.settingsLoadPromise = null;
    });

  appState.settingsLoadPromise = request;
  return request;
}

async function saveSettings() {
  appState.settingsSaving = true;
  elements.settings.save.disabled = true;
  renderSettingsState('Guardando...', 'neutral');

  try {
    const payload = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(readSettingsForm()),
    });

    appState.settings = payload.settings;
    appState.settingsDirty = false;
    applySettingsToForm(payload.settings);
    updateGlobalHeader();
    renderSettingsState('Guardado', 'success');
    showSettingsAlert(
      payload.settings.ownerContactOverride
        ? 'Settings guardados. El override de propietario sigue activo para pruebas.'
        : payload.settings.selectionNotificationEnabled && payload.settings.selectionNotificationRecipients
          ? 'Settings guardados. La notificación de selección quedó activa para las nuevas elecciones de finca.'
          : 'Settings guardados. Aplican a nuevas ejecuciones y nuevos follow-ons.',
      payload.settings.ownerContactOverride ? 'warn' : 'success',
    );

    if (appState.monitoring.loaded) {
      void loadMonitoringData();
    }
  } catch (error) {
    renderSettingsState('Error guardando', 'warn');
    showSettingsAlert(error.message, 'error');
  } finally {
    appState.settingsSaving = false;
    elements.settings.save.disabled = false;
  }
}

function markSettingsDirty() {
  if (!appState.settingsLoaded) return;
  appState.settingsDirty = true;
  renderSettingsState('Cambios sin guardar', 'warn');
}

function getActiveConversation() {
  return (
    appState.simulator.conversations.find((conversation) => conversation.id === appState.simulator.activeConversationId) ||
    null
  );
}

function normalizeMessageContent(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getMessageCreatedAt(message) {
  return message?.createdAt || message?.created_at || new Date().toISOString();
}

function getMessageTimestamp(message) {
  const timestamp = Date.parse(getMessageCreatedAt(message));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeMessageRecord(message) {
  return {
    ...message,
    createdAt: getMessageCreatedAt(message),
    content: String(message?.content || ''),
    direction: message?.direction || 'INBOUND',
    messageType: message?.messageType || message?.message_type || 'TEXT',
    stateAtTime: message?.stateAtTime || message?.state_at_time || null,
    agentUsed: message?.agentUsed || message?.agent_used || '',
    localSequence: Number(message?.localSequence || message?.local_sequence || 0) || 0,
  };
}

function compareMessages(left, right) {
  const timeDiff = getMessageTimestamp(left) - getMessageTimestamp(right);
  if (timeDiff !== 0) return timeDiff;

  const directionWeight = { INBOUND: 0, OUTBOUND: 1 };
  const weightDiff = (directionWeight[left.direction] ?? 9) - (directionWeight[right.direction] ?? 9);
  if (weightDiff !== 0) return weightDiff;

  if (Boolean(left.pending) !== Boolean(right.pending)) {
    return left.pending ? 1 : -1;
  }

  const localSequenceDiff = (left.localSequence || 0) - (right.localSequence || 0);
  if (localSequenceDiff !== 0) return localSequenceDiff;

  return String(left.id || '').localeCompare(String(right.id || ''));
}

function getPendingMessagesFor(conversationId) {
  return appState.simulator.pendingByConversation[conversationId] || [];
}

function setPendingMessagesFor(conversationId, messages) {
  const normalized = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (normalized.length) {
    appState.simulator.pendingByConversation[conversationId] = normalized;
    return;
  }
  delete appState.simulator.pendingByConversation[conversationId];
}

function addPendingMessage(conversationId, message) {
  setPendingMessagesFor(conversationId, [...getPendingMessagesFor(conversationId), message]);
}

function updatePendingMessage(conversationId, localId, patch) {
  const messages = getPendingMessagesFor(conversationId);
  if (!messages.length) return;
  setPendingMessagesFor(
    conversationId,
    messages.map((message) => (message.localId === localId ? { ...message, ...patch } : message)),
  );
}

function removePendingMessage(conversationId, localId) {
  setPendingMessagesFor(
    conversationId,
    getPendingMessagesFor(conversationId).filter((message) => message.localId !== localId),
  );
}

function getPollingState(conversationId, { create = false } = {}) {
  const existing = appState.simulator.pollingByConversation[conversationId];
  if (existing || !create) return existing || null;

  const created = {
    running: false,
    timerId: null,
    turns: [],
    attempts: 0,
    lastFingerprint: null,
    quietSince: null,
    hadReply: false,
    startedAt: Date.now(),
  };
  appState.simulator.pollingByConversation[conversationId] = created;
  return created;
}

function clearConversationPollTimer(conversationId) {
  const pollState = getPollingState(conversationId);
  if (!pollState?.timerId) return;
  clearTimeout(pollState.timerId);
  pollState.timerId = null;
}

function stopConversationPolling(conversationId) {
  const pollState = getPollingState(conversationId);
  if (!pollState) return;
  clearConversationPollTimer(conversationId);
  delete appState.simulator.pollingByConversation[conversationId];
}

function hasActivePollingFor(conversationId) {
  const pollState = getPollingState(conversationId);
  return Boolean(
    pollState &&
      (pollState.running || pollState.timerId || pollState.turns.length || getPendingMessagesFor(conversationId).length),
  );
}

function buildMessageFingerprint(messages) {
  return [...messages]
    .slice(-6)
    .map((message) => `${message.id || 'no-id'}|${message.direction}|${getMessageCreatedAt(message)}|${message.content}`)
    .join('||');
}

function reconcilePendingMessages(conversationId, persistedMessages) {
  const pendingMessages = [...getPendingMessagesFor(conversationId)].sort(compareMessages);
  if (!pendingMessages.length) return;

  const persistedInbounds = persistedMessages
    .filter((message) => message.direction === 'INBOUND')
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareMessages(left.message, right.message));

  const usedServerIndexes = new Set();
  const remaining = [];

  for (const pending of pendingMessages) {
    const pendingText = normalizeMessageContent(pending.content);
    const pendingTimestamp = Date.parse(pending.queuedAt || pending.createdAt || new Date().toISOString());

    const match = persistedInbounds.find(({ message, index }) => {
      if (usedServerIndexes.has(index)) return false;
      if (normalizeMessageContent(message.content) !== pendingText) return false;
      const messageTimestamp = getMessageTimestamp(message);
      return messageTimestamp >= pendingTimestamp - 30000 && messageTimestamp <= pendingTimestamp + 180000;
    });

    if (match) {
      usedServerIndexes.add(match.index);
      continue;
    }

    remaining.push(pending);
  }

  setPendingMessagesFor(conversationId, remaining);
}

function getThreadMessages(conversation) {
  const persisted = (conversation?.messages || []).map(normalizeMessageRecord);
  const pending = getPendingMessagesFor(conversation?.id || '').map((message) => normalizeMessageRecord(message));
  const combined = [...persisted];

  for (const localMessage of pending) {
    const duplicate = persisted.some(
      (message) =>
        message.direction === localMessage.direction &&
        normalizeMessageContent(message.content) === normalizeMessageContent(localMessage.content) &&
        Math.abs(getMessageTimestamp(message) - getMessageTimestamp(localMessage)) <= 180000,
    );

    if (!duplicate) {
      combined.push(localMessage);
    }
  }

  return combined.sort(compareMessages);
}

function upsertConversationSnapshot(snapshot) {
  const conversations = appState.simulator.conversations;
  const index = conversations.findIndex((conversation) => conversation.id === snapshot.id);
  if (index !== -1) {
    conversations.splice(index, 1);
  }
  conversations.unshift(snapshot);
}

function scheduleConversationPoll(conversationId, delay = 1200) {
  const pollState = getPollingState(conversationId, { create: true });
  clearConversationPollTimer(conversationId);
  pollState.timerId = window.setTimeout(() => {
    void pollConversation(conversationId);
  }, delay);
}

async function pollConversation(conversationId) {
  const pollState = getPollingState(conversationId);
  if (!pollState) return;

  clearConversationPollTimer(conversationId);
  pollState.running = true;
  pollState.attempts += 1;

  try {
    const snapshot = await api(`/api/conversations/${conversationId}`);
    upsertConversationSnapshot(snapshot);

    const normalizedMessages = (snapshot.messages || []).map(normalizeMessageRecord).sort(compareMessages);
    reconcilePendingMessages(conversationId, normalizedMessages);

    const latestOutboundTimestamp = normalizedMessages
      .filter((message) => message.direction === 'OUTBOUND')
      .reduce((latest, message) => Math.max(latest, getMessageTimestamp(message)), 0);

    for (const turn of pollState.turns) {
      const turnTimestamp = Date.parse(turn.queuedAt || turn.createdAt || new Date().toISOString());
      if (latestOutboundTimestamp && latestOutboundTimestamp >= turnTimestamp - 1000) {
        turn.repliedAt = latestOutboundTimestamp;
      }
    }

    if (pollState.turns.some((turn) => Boolean(turn.repliedAt))) {
      pollState.hadReply = true;
    }

    pollState.turns = pollState.turns.filter((turn) => !turn.repliedAt);

    const fingerprint = buildMessageFingerprint(normalizedMessages);
    if (fingerprint !== pollState.lastFingerprint) {
      pollState.lastFingerprint = fingerprint;
      pollState.quietSince = null;
    } else if (!pollState.quietSince) {
      pollState.quietSince = Date.now();
    }

    renderSimulator();

    const hasPending = getPendingMessagesFor(conversationId).length > 0;
    const hasOutstandingTurns = pollState.turns.length > 0;
    const quietEnough = Boolean(pollState.quietSince && Date.now() - pollState.quietSince >= 2500);
    const pollingTimedOut = Date.now() - pollState.startedAt >= 120000;

    if ((!hasPending && !hasOutstandingTurns && (pollState.hadReply || quietEnough)) || pollingTimedOut) {
      stopConversationPolling(conversationId);
      renderSimulator();
      return;
    }

    scheduleConversationPoll(conversationId, 1100);
  } catch {
    if (pollState.attempts >= 120) {
      stopConversationPolling(conversationId);
      renderSimulator();
      return;
    }

    scheduleConversationPoll(conversationId, 1800);
  } finally {
    const current = getPollingState(conversationId);
    if (current) current.running = false;
  }
}

function renderConversationList() {
  const filter = appState.simulator.filter.trim().toLowerCase();
  const conversations = appState.simulator.conversations.filter((conversation) => {
    const preview = getThreadMessages(conversation).at(-1)?.content || conversation.lastMessage?.content || '';
    if (!filter) return true;
    return (
      conversation.title.toLowerCase().includes(filter) ||
      stageLabel(conversation.stage).toLowerCase().includes(filter) ||
      String(preview).toLowerCase().includes(filter)
    );
  });

  elements.simulator.list.innerHTML = '';

  for (const conversation of conversations) {
    const threadMessages = getThreadMessages(conversation);
    const previewMessage = threadMessages.at(-1)?.content || conversation.lastMessage?.content || 'Sin mensajes todavía';
    const previewTime = threadMessages.at(-1)?.createdAt || conversation.updatedAt || conversation.createdAt;
    const node = elements.simulator.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = conversation.id;
    node.classList.toggle('is-active', conversation.id === appState.simulator.activeConversationId);
    node.querySelector('.conversation-item__avatar').textContent = initialsFromTitle(conversation.title);
    node.querySelector('.conversation-item__title').textContent = conversation.title;
    node.querySelector('.conversation-item__time').textContent = formatDateTime(previewTime);
    node.querySelector('.conversation-item__preview').textContent = previewMessage;
    node.querySelector('.conversation-item__stage').textContent = stageLabel(conversation.stage);
    node.addEventListener('click', () => {
      appState.simulator.activeConversationId = conversation.id;
      renderSimulator();
    });
    elements.simulator.list.appendChild(node);
  }
}

function renderSimulatorThread() {
  const conversation = getActiveConversation();

  if (!conversation) {
    elements.simulator.thread.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>Selecciona una conversación</h3>
          <p>Crea pruebas nuevas y revisa cómo cambia la etapa del agente en cada turno.</p>
        </div>
      </div>
    `;
    return;
  }

  const messages = getThreadMessages(conversation);

  if (!messages.length) {
    elements.simulator.thread.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>${escapeHtml(conversation.title)}</h3>
          <p>Escribe el primer mensaje para iniciar la conversación con el agente.</p>
        </div>
      </div>
    `;
    return;
  }

  const html = messages
    .map((message) => {
      const outbound = message.direction === 'OUTBOUND';
      const bubbleClass = outbound ? 'message-bubble--outbound' : 'message-bubble--inbound';
      const rowClass = outbound ? 'bubble-row--outbound' : '';
      const meta = [
        formatDateTime(message.createdAt),
        message.agentUsed,
        message.pending
          ? message.status === 'sending'
            ? 'enviando…'
            : message.status === 'queued'
              ? 'en cola'
              : 'pendiente'
          : null,
      ]
        .filter(Boolean)
        .join(' · ');

      return `
        <div class="bubble-row ${rowClass}">
          <article class="message-bubble ${bubbleClass}">
            <div>${escapeHtml(message.content || '').replace(/\n/g, '<br>')}</div>
            <footer class="message-bubble__meta">
              <span>${escapeHtml(meta)}</span>
            </footer>
          </article>
        </div>
      `;
    })
    .join('');

  const typingIndicator = hasActivePollingFor(conversation.id)
    ? `
      <div class="bubble-row">
        <article class="message-bubble message-bubble--typing">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
          <footer class="message-bubble__meta">
            <span>Agente respondiendo...</span>
          </footer>
        </article>
      </div>
    `
    : '';

  elements.simulator.thread.innerHTML = `<div class="message-group">${html}${typingIndicator}</div>`;
  elements.simulator.thread.scrollTop = elements.simulator.thread.scrollHeight;
}

function renderSimulatorHeader() {
  const conversation = getActiveConversation();

  if (!conversation) {
    elements.simulator.title.textContent = 'Selecciona una conversación';
    elements.simulator.avatar.textContent = 'AG';
    elements.simulator.stage.textContent = 'NEW';
    elements.simulator.status.textContent = 'Sin actividad';
    return;
  }

  elements.simulator.title.textContent = conversation.title;
  elements.simulator.avatar.textContent = initialsFromTitle(conversation.title);
  elements.simulator.stage.textContent = stageLabel(conversation.stage);
  elements.simulator.status.textContent =
    getPendingMessagesFor(conversation.id).length || hasActivePollingFor(conversation.id)
      ? 'Agente respondiendo...'
      : conversation.agenteActivo === false
        ? 'HITL activo'
        : `Esperando: ${conversation.waitingFor || 'CLIENT'}`;
}

function renderSimulatorInspector() {
  const conversation = getActiveConversation();

  if (!conversation) {
    elements.simulator.inspector.innerHTML = `
      <div class="inspector-empty">
        <p>Selecciona una conversación para ver la etapa, la finca elegida y el contexto completo.</p>
      </div>
    `;
    return;
  }

  const context = conversation.context || {};
  const searchCriteria = context.search_criteria || {};
  const selectedFinca = context.selected_finca || null;
  const ownerResponse = context.owner_response || null;
  const pricing = context.pricing || {};

  elements.simulator.inspector.innerHTML = `
    <section class="info-card">
      <h3>Resumen operativo</h3>
      <dl class="info-grid">
        <div class="info-row"><dt>Etapa</dt><dd>${escapeHtml(stageLabel(conversation.stage))}</dd></div>
        <div class="info-row"><dt>Esperando</dt><dd>${escapeHtml(conversation.waitingFor || 'CLIENT')}</dd></div>
        <div class="info-row"><dt>Bot activo</dt><dd>${conversation.agenteActivo === false ? 'No' : 'Sí'}</dd></div>
        <div class="info-row"><dt>Última actividad</dt><dd>${escapeHtml(
          formatDateTimeLong(conversation.updatedAt || conversation.createdAt),
        )}</dd></div>
      </dl>
    </section>

    <section class="info-card">
      <h3>Criterios de búsqueda</h3>
      <div class="context-list">
        ${Object.entries(searchCriteria)
          .filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
          .map(
            ([key, value]) =>
              `<span class="context-chip">${escapeHtml(key)}: ${
                Array.isArray(value)
                  ? escapeHtml(value.join(', '))
                  : escapeHtml(JSON.stringify(value).replace(/^"|"$/g, ''))
              }</span>`,
          )
          .join('') || '<span class="context-chip">Sin criterios confirmados todavía</span>'}
      </div>
    </section>

    <section class="info-card">
      <h3>Finca seleccionada</h3>
      ${
        selectedFinca
          ? `
            <dl class="info-grid">
              <div class="info-row"><dt>ID</dt><dd>${escapeHtml(
                selectedFinca.finca_id || conversation.context?.selected_finca_id || '-',
              )}</dd></div>
              <div class="info-row"><dt>Nombre</dt><dd>${escapeHtml(selectedFinca.nombre || '-')}</dd></div>
              <div class="info-row"><dt>Zona</dt><dd>${escapeHtml(selectedFinca.zona || '-')}</dd></div>
            </dl>
          `
          : '<p class="inspector-empty">Todavía no hay finca elegida.</p>'
      }
    </section>

    <section class="info-card">
      <h3>Respuesta de propietario</h3>
      ${
        ownerResponse
          ? `<pre class="json-block">${escapeHtml(JSON.stringify(ownerResponse, null, 2))}</pre>`
          : '<p class="inspector-empty">Aún no hay confirmación del propietario.</p>'
      }
    </section>

    <section class="info-card">
      <h3>Pricing</h3>
      <pre class="json-block">${escapeHtml(JSON.stringify(pricing, null, 2))}</pre>
    </section>

    <section class="info-card">
      <h3>Contexto completo</h3>
      <details open>
        <summary>Ver JSON</summary>
        <pre class="json-block">${escapeHtml(JSON.stringify(context, null, 2))}</pre>
      </details>
    </section>
  `;
}

function renderSimulator() {
  elements.simulator.workflowBadge.textContent = appState.workflow
    ? `${appState.workflow.workflowName} · ${appState.workflow.workflowId}`
    : 'Simulación real contra n8n';

  renderConversationList();
  renderSimulatorHeader();
  renderSimulatorThread();
  renderSimulatorInspector();

  elements.simulator.input.disabled = !appState.simulator.activeConversationId;
  elements.simulator.send.disabled = !appState.simulator.activeConversationId || !elements.simulator.input.value.trim();
}

async function bootstrapSimulator() {
  const payload = await api('/api/bootstrap');
  appState.workflow = payload.workflow;
  appState.simulator.conversations = payload.conversations;
  appState.simulator.activeConversationId = payload.conversations[0]?.id || null;
  appState.simulator.loaded = true;
  appState.settings = payload.settings;
  appState.settingsLoaded = true;
  appState.timezone = payload.timezone || 'America/Bogota';
  applySettingsToForm(payload.settings);
  updateGlobalHeader();
  renderSettingsState('Configuración cargada', 'success');
  renderSimulator();
}

async function reloadConversations() {
  appState.simulator.conversations = await api('/api/conversations');
  if (!appState.simulator.activeConversationId && appState.simulator.conversations.length) {
    appState.simulator.activeConversationId = appState.simulator.conversations[0].id;
  }
  renderSimulator();
}

async function createConversation() {
  const snapshot = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  upsertConversationSnapshot(snapshot);
  appState.simulator.activeConversationId = snapshot.id;
  renderSimulator();
  elements.simulator.input.focus();
}

function autoResizeTextarea() {
  elements.simulator.input.style.height = '0px';
  const nextHeight = Math.max(54, Math.min(elements.simulator.input.scrollHeight, 180));
  elements.simulator.input.style.height = `${nextHeight}px`;
  elements.simulator.send.disabled = !appState.simulator.activeConversationId || !elements.simulator.input.value.trim();
}

async function sendMessage(event) {
  event.preventDefault();
  const conversation = getActiveConversation();
  const text = elements.simulator.input.value.trim();

  if (!conversation || !text) return;

  const localId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const localSequence = appState.simulator.nextLocalSequence++;

  addPendingMessage(conversation.id, {
    id: localId,
    localId,
    clientMessageId: localId,
    direction: 'INBOUND',
    content: text,
    messageType: 'TEXT',
    stateAtTime: conversation.stage || 'NEW',
    agentUsed: 'USER',
    createdAt,
    localSequence,
    pending: true,
    status: 'sending',
  });
  elements.simulator.input.value = '';
  autoResizeTextarea();
  renderSimulator();

  try {
    const payload = await enqueueConversationSend(conversation.id, () =>
      api(`/api/conversations/${conversation.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text, clientMessageId: localId, localSequence }),
      }),
    );

    const queuedAt = payload.queuedAt || new Date().toISOString();
    updatePendingMessage(conversation.id, localId, {
      status: 'queued',
      queuedAt,
    });

    const pollState = getPollingState(conversation.id, { create: true });
    pollState.turns.push({
      localId,
      text,
      createdAt,
      queuedAt,
      localSequence,
    });

    scheduleConversationPoll(conversation.id, 250);
    renderSimulator();
    return;
  } catch (error) {
    removePendingMessage(conversation.id, localId);
    if (!elements.simulator.input.value.trim()) {
      elements.simulator.input.value = text;
    }
    autoResizeTextarea();
    renderSimulator();
    window.alert(error.message);
  }
}

function buildMonitoringQueryString() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(appState.monitoring.filters)) {
    if (value && value !== 'all') {
      params.set(key, value);
    } else if (key === 'search' && value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

function renderMonitoringSummary() {
  const summary = appState.monitoring.summary || {
    total: 0,
    botActive: 0,
    hitl: 0,
    waitingClient: 0,
    waitingOwner: 0,
    converted: 0,
    pendingFollowOn: 0,
    dueFollowOn: 0,
  };

  const cards = [
    ['Total', summary.total],
    ['Bot activo', summary.botActive],
    ['HITL', summary.hitl],
    ['Esperando cliente', summary.waitingClient],
    ['Esperando propietario', summary.waitingOwner],
    ['Cerrados / elegida', summary.converted],
    ['Follow on pendiente', summary.pendingFollowOn],
    ['Follow on vencido', summary.dueFollowOn],
  ];

  elements.monitoring.summary.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <span class="metric-card__label">${escapeHtml(label)}</span>
          <strong class="metric-card__value">${escapeHtml(value)}</strong>
        </article>
      `,
    )
    .join('');
}

function renderMonitoringTable() {
  elements.monitoring.count.textContent = `${appState.monitoring.conversations.length} conversaciones`;

  if (!appState.monitoring.conversations.length) {
    elements.monitoring.tableBody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="inspector-empty">
            <p>No hay conversaciones para los filtros seleccionados.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  elements.monitoring.tableBody.innerHTML = appState.monitoring.conversations
    .map((conversation) => {
      const selected = conversation.waId === appState.monitoring.selectedConversationId;
      const followOn = conversation.followOn;
      const followOnLabel = followOn
        ? `${followOn.status} · ${formatCountdown(followOn.remainingMs)}`
        : 'Sin follow on';
      const botLabel = conversation.agenteActivo ? 'Activo' : 'HITL';
      const selectedFinca = conversation.selectedFincaName || 'Sin elegir';
      const lastInteraction = formatDateTime(conversation.lastInteractionAt);
      const lastMessage = conversation.lastMessage?.content || '';

      return `
        <tr class="monitor-row ${selected ? 'monitor-row--active' : ''}" data-id="${escapeHtml(conversation.waId)}">
          <td>
            <div class="monitor-primary">
              <strong>${escapeHtml(conversation.clientName)}</strong>
              <span>${escapeHtml(conversation.waId)}</span>
              <small>${escapeHtml(lastMessage.slice(0, 96) || 'Sin mensajes')}</small>
            </div>
          </td>
          <td><span class="stage-chip">${escapeHtml(conversation.currentState || 'NEW')}</span></td>
          <td><span class="monitor-badge ${conversation.agenteActivo ? 'monitor-badge--active' : 'monitor-badge--hitl'}">${escapeHtml(botLabel)}</span></td>
          <td>${escapeHtml(conversation.waitingFor || 'CLIENT')}</td>
          <td>${escapeHtml(selectedFinca)}</td>
          <td>${escapeHtml(followOnLabel)}</td>
          <td>${escapeHtml(lastInteraction)}</td>
        </tr>
      `;
    })
    .join('');

  for (const row of elements.monitoring.tableBody.querySelectorAll('.monitor-row')) {
    row.addEventListener('click', () => {
      appState.monitoring.selectedConversationId = row.dataset.id;
      renderMonitoringTable();
      void loadConversationDetail(row.dataset.id);
    });
  }
}

function renderMonitoringDetail() {
  const detail = appState.monitoring.selectedConversation;

  if (!detail) {
    elements.monitoring.detailTitle.textContent = 'Selecciona una conversación';
    elements.monitoring.detailBody.innerHTML = `
      <div class="inspector-empty">
        <p>Selecciona una conversación para ver contexto, follow ons y mensajes recientes.</p>
      </div>
    `;
    return;
  }

  const conversation = detail.conversation || {};
  const context = conversation.context || {};
  const followOn = detail.followOn || [];
  const messages = detail.messages || [];
  const settingsStatus = detail.settingsStatus || appState.monitoring.settingsStatus || {};
  const selectionNotifications = detail.selectionNotifications || [];

  elements.monitoring.detailTitle.textContent = conversation.client_name || conversation.wa_id || 'Detalle';
  elements.monitoring.detailBody.innerHTML = `
    <section class="info-card">
      <h3>Resumen</h3>
      <dl class="info-grid">
        <div class="info-row"><dt>Teléfono</dt><dd>${escapeHtml(conversation.wa_id || '-')}</dd></div>
        <div class="info-row"><dt>Chatwoot</dt><dd>${escapeHtml(conversation.chatwoot_id || '-')}</dd></div>
        <div class="info-row"><dt>Etapa</dt><dd>${escapeHtml(conversation.current_state || '-')}</dd></div>
        <div class="info-row"><dt>Esperando</dt><dd>${escapeHtml(conversation.waiting_for || 'CLIENT')}</dd></div>
        <div class="info-row"><dt>Bot activo</dt><dd>${conversation.agente_activo === false ? 'No' : 'Sí'}</dd></div>
        <div class="info-row"><dt>Finca elegida</dt><dd>${escapeHtml(
          conversation.selected_finca?.nombre || conversation.selected_finca_id || 'Sin elegir',
        )}</dd></div>
        <div class="info-row"><dt>Override propietario</dt><dd>${settingsStatus.ownerContactOverrideActive ? 'Activo' : 'No'}</dd></div>
      </dl>
    </section>

    <section class="info-card">
      <h3>Follow on</h3>
      ${
        followOn.length
          ? `<div class="monitor-follow-list">
              ${followOn
                .map(
                  (entry) => `
                    <article class="monitor-follow-card">
                      <strong>${escapeHtml(entry.status || 'sin estado')}</strong>
                      <span>${escapeHtml(formatDateTimeLong(entry.scheduledFor || entry.createdAt))}</span>
                      <p>${escapeHtml(entry.message || 'Sin mensaje')}</p>
                      <small>${escapeHtml(entry.cancelReason || '')}</small>
                    </article>
                  `,
                )
                .join('')}
            </div>`
          : '<p class="inspector-empty">No hay follow ons registrados.</p>'
      }
    </section>

    <section class="info-card">
      <h3>Notificaciones de selección</h3>
      ${
        selectionNotifications.length
          ? `<div class="monitor-follow-list">
              ${selectionNotifications
                .map(
                  (entry) => `
                    <article class="monitor-follow-card">
                      <strong>${escapeHtml(entry.status || 'sin estado')}</strong>
                      <span>${escapeHtml(entry.recipientPhone || '-')}</span>
                      <p>${escapeHtml(entry.selectedFincaId || 'Sin finca')} · ${escapeHtml(entry.templateName || '-')}</p>
                      <small>${escapeHtml(entry.errorMessage || entry.providerMessageId || '')}</small>
                    </article>
                  `,
                )
                .join('')}
            </div>`
          : '<p class="inspector-empty">No hay alertas de selección registradas.</p>'
      }
    </section>

    <section class="info-card">
      <h3>Mensajes recientes</h3>
      <div class="monitor-message-list">
        ${
          messages.length
            ? messages
                .slice(-12)
                .map(
                  (message) => `
                    <article class="monitor-message-card">
                      <header>
                        <strong>${escapeHtml(message.direction)}</strong>
                        <span>${escapeHtml(formatDateTimeLong(message.createdAt))}</span>
                      </header>
                      <p>${escapeHtml(message.content || '')}</p>
                      <small>${escapeHtml(message.agentUsed || '')}</small>
                    </article>
                  `,
                )
                .join('')
            : '<p class="inspector-empty">No hay mensajes todavía.</p>'
        }
      </div>
    </section>

    <section class="info-card">
      <h3>Contexto completo</h3>
      <pre class="json-block">${escapeHtml(JSON.stringify(context, null, 2))}</pre>
    </section>
  `;
}

async function loadConversationDetail(waId) {
  try {
    const detail = await api(`/api/monitoring/conversations/${encodeURIComponent(waId)}`);
    appState.monitoring.selectedConversation = detail;
    renderMonitoringDetail();
  } catch (error) {
    window.alert(error.message);
  }
}

async function loadMonitoringData() {
  if (appState.monitoring.loading) return;
  appState.monitoring.loading = true;

  try {
    const query = buildMonitoringQueryString();
    const payload = await api(`/api/monitoring${query ? `?${query}` : ''}`);
    appState.monitoring.summary = payload.summary;
    appState.monitoring.conversations = payload.conversations;
    appState.monitoring.businessHours = payload.businessHours || appState.monitoring.businessHours;
    appState.monitoring.settingsStatus = payload.settingsStatus || null;
    appState.monitoring.loaded = true;
    appState.timezone = payload.timezone || appState.timezone;
    elements.monitoring.hours.textContent = `${payload.businessHours.start}-${payload.businessHours.end} · ${payload.timezone}`;

    if (!appState.monitoring.selectedConversationId && appState.monitoring.conversations[0]) {
      appState.monitoring.selectedConversationId = appState.monitoring.conversations[0].waId;
    }

    if (
      appState.monitoring.selectedConversationId &&
      !appState.monitoring.conversations.some((item) => item.waId === appState.monitoring.selectedConversationId)
    ) {
      appState.monitoring.selectedConversationId = appState.monitoring.conversations[0]?.waId || null;
      appState.monitoring.selectedConversation = null;
    }

    renderMonitoringSummary();
    renderMonitoringTable();

    if (appState.monitoring.selectedConversationId) {
      await loadConversationDetail(appState.monitoring.selectedConversationId);
    } else {
      appState.monitoring.selectedConversation = null;
      renderMonitoringDetail();
    }
  } catch (error) {
    elements.monitoring.detailBody.innerHTML = `
      <div class="inspector-empty">
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  } finally {
    appState.monitoring.loading = false;
  }
}

function bindSimulator() {
  elements.simulator.form.addEventListener('submit', sendMessage);
  elements.simulator.create.addEventListener('click', () => {
    void createConversation();
  });
  elements.simulator.search.addEventListener('input', (event) => {
    appState.simulator.filter = event.target.value || '';
    renderConversationList();
  });
  elements.simulator.input.addEventListener('input', autoResizeTextarea);
  elements.simulator.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      elements.simulator.form.requestSubmit();
    }
  });
}

function bindMonitoring() {
  const sync = () => {
    appState.monitoring.filters.search = elements.monitoring.search.value.trim().toLowerCase();
    appState.monitoring.filters.timeframe = elements.monitoring.timeframe.value;
    appState.monitoring.filters.agent = elements.monitoring.agent.value;
    appState.monitoring.filters.waitingFor = elements.monitoring.waiting.value;
    appState.monitoring.filters.converted = elements.monitoring.converted.value;
    appState.monitoring.filters.followOn = elements.monitoring.followOn.value;
    void loadMonitoringData();
  };

  for (const element of [
    elements.monitoring.search,
    elements.monitoring.timeframe,
    elements.monitoring.agent,
    elements.monitoring.waiting,
    elements.monitoring.converted,
    elements.monitoring.followOn,
  ]) {
    element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', sync);
  }
}

function bindSettings() {
  elements.settings.form.addEventListener('input', markSettingsDirty);
  elements.settings.form.addEventListener('change', markSettingsDirty);
  elements.settings.save.addEventListener('click', (event) => {
    event.preventDefault();
    void saveSettings();
  });
}

function bindTabs() {
  for (const tab of elements.tabs) {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveTab(tab.dataset.tab);
    });
  }

  window.addEventListener('popstate', () => {
    setActiveTab(routeToTab[window.location.pathname] || 'simulator', { pushState: false });
  });
}

async function init() {
  bindTabs();
  bindSimulator();
  bindMonitoring();
  bindSettings();

  try {
    await bootstrapSimulator();
  } catch (error) {
    elements.simulator.thread.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>No pude iniciar el simulador</h3>
          <p>${escapeHtml(error.message)}</p>
        </div>
      </div>
    `;
  }

  setActiveTab(appState.activeTab, { pushState: false });
  autoResizeTextarea();

  if (appState.activeTab === 'monitoring') {
    void loadMonitoringData();
  }

  if (appState.activeTab === 'settings' && !appState.settingsLoaded) {
    void loadSettings();
  }
}

void init();
