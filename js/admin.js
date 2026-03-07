/**
 * Admin panel — Dashboard, Users (view/edit/ban), Game settings.
 * Requires admin login; checks /api/me for isAdmin.
 */
(function () {
  'use strict';

  const api = {
    async me() {
      const res = await fetch('/api/me', { credentials: 'include' });
      const data = await res.json().catch(function () { return {}; });
      return { ok: res.ok, data };
    },
    async logout() {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    },
    async stats() {
      const res = await fetch('/api/admin/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load stats');
      return res.json();
    },
    async users() {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
    async getUser(username) {
      const res = await fetch('/api/admin/users/' + encodeURIComponent(username), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load user');
      return res.json();
    },
    async updateUser(username, body) {
      const res = await fetch('/api/admin/users/' + encodeURIComponent(username), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || 'Failed to update user');
      return data;
    },
    async deleteUser(username) {
      const res = await fetch('/api/admin/users/' + encodeURIComponent(username), {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');
      return data;
    },
    async getGameConfig() {
      const res = await fetch('/api/admin/game-config', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load game config');
      return res.json();
    },
    async saveGameConfig(config) {
      const res = await fetch('/api/admin/game-config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || 'Failed to save config');
      return data;
    }
  };

  let usersList = [];
  let currentModalUser = null;

  const el = {
    loading: document.getElementById('admin-loading'),
    denied: document.getElementById('admin-denied'),
    main: document.querySelector('.admin-main'),
    tabs: document.querySelectorAll('.admin-tab'),
    panels: document.querySelectorAll('.admin-tab-panel'),
    statUsers: document.getElementById('stat-users'),
    statBanned: document.getElementById('stat-banned'),
    statGames: document.getElementById('stat-games'),
    statWins: document.getElementById('stat-wins'),
    statTopscore: document.getElementById('stat-topscore'),
    usersSearch: document.getElementById('users-search'),
    usersTbody: document.getElementById('users-tbody'),
    userModal: document.getElementById('user-modal'),
    userModalTitle: document.getElementById('user-modal-title'),
    userModalBody: document.getElementById('user-modal-body'),
    userModalClose: document.getElementById('user-modal-close'),
    userModalBan: document.getElementById('user-modal-ban'),
    userModalUnban: document.getElementById('user-modal-unban'),
    userModalDelete: document.getElementById('user-modal-delete'),
    userModalSave: document.getElementById('user-modal-save'),
    gameConfigForm: document.getElementById('game-config-form'),
    gameConfigError: document.getElementById('game-config-error'),
    gameConfigSave: document.getElementById('game-config-save'),
    notifications: document.getElementById('admin-notifications'),
    confirmModal: document.getElementById('admin-confirm-modal'),
    confirmMessage: document.getElementById('admin-confirm-message'),
    confirmCancel: document.getElementById('admin-confirm-cancel'),
    confirmDelete: document.getElementById('admin-confirm-delete')
  };

  var confirmCallback = null;

  function showConfirmModal(message, onConfirm) {
    confirmCallback = onConfirm;
    if (el.confirmMessage) el.confirmMessage.textContent = message;
    if (el.confirmModal) el.confirmModal.classList.remove('hidden');
  }

  function hideConfirmModal() {
    confirmCallback = null;
    if (el.confirmModal) el.confirmModal.classList.add('hidden');
  }

  function showNotification(message, type) {
    type = type === 'error' ? 'error' : 'success';
    var container = el.notifications;
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'admin-notification admin-notification--' + type;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'opacity 0.2s, transform 0.2s';
        setTimeout(function () {
          if (toast.parentNode) container.removeChild(toast);
        }, 200);
      }
    }, 4500);
  }

  function show(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  function switchTab(tabId) {
    el.tabs.forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
    });
    el.panels.forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + tabId);
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function checkAccess() {
    const { ok, data } = await api.me();
    if (!ok || !data.isAdmin) {
      show(el.loading, false);
      show(el.denied, true);
      show(el.main, false);
      return false;
    }
    show(el.loading, false);
    show(el.denied, false);
    show(el.main, true);
    return true;
  }

  async function loadDashboard() {
    try {
      const s = await api.stats();
      el.statUsers.textContent = s.totalUsers ?? '—';
      el.statBanned.textContent = s.bannedCount ?? '—';
      el.statGames.textContent = s.totalGames ?? '—';
      el.statWins.textContent = s.totalWins ?? '—';
      el.statTopscore.textContent = s.topScore ?? '—';
    } catch (e) {
      el.statUsers.textContent = '—';
      showNotification(e.message || 'Failed to load stats.', 'error');
    }
  }

  function renderUsersTable(list) {
    var query = (el.usersSearch && el.usersSearch.value || '').trim().toLowerCase();
    var filtered = query
      ? list.filter(function (u) {
          return (u.username && u.username.toLowerCase().indexOf(query) !== -1) ||
                 (u.email && u.email.toLowerCase().indexOf(query) !== -1);
        })
      : list;

    if (!el.usersTbody) return;
    el.usersTbody.innerHTML = filtered.map(function (u) {
      var status = u.role === 'admin' ? '<span class="badge badge-admin">Admin</span>' : (u.banned ? '<span class="badge badge-banned">Banned</span>' : '<span>Active</span>');
      return (
        '<tr>' +
        '<td>' + escapeHtml(u.username) + '</td>' +
        '<td>' + escapeHtml(u.email || '') + '</td>' +
        '<td>' + (u.highScore ?? 0) + '</td>' +
        '<td>' + (u.totalGames ?? 0) + '</td>' +
        '<td>' + (u.wins ?? 0) + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' +
        (u.username !== 'admin' ? '<button type="button" class="btn btn-secondary btn-sm btn-view-user" data-username="' + escapeHtml(u.username) + '">View</button>' : '') +
        '</td></tr>'
      );
    }).join('');

    document.querySelectorAll('.btn-view-user').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openUserModal(btn.getAttribute('data-username'));
      });
    });
  }

  async function loadUsers() {
    try {
      usersList = await api.users();
      renderUsersTable(usersList);
    } catch (e) {
      if (el.usersTbody) el.usersTbody.innerHTML = '<tr><td colspan="7">Failed to load users.</td></tr>';
      showNotification(e.message || 'Failed to load users.', 'error');
    }
  }

  async function openUserModal(username) {
    currentModalUser = username;
    try {
      var u = await api.getUser(username);
      el.userModalTitle.textContent = 'User: ' + escapeHtml(u.username);
      el.userModalBody.innerHTML =
        '<p><strong>Username</strong> ' + escapeHtml(u.username) + '</p>' +
        '<p><strong>Email</strong> ' + escapeHtml(u.email || '') + '</p>' +
        '<p><strong>High score</strong> ' + (u.highScore ?? 0) + '</p>' +
        '<p><strong>Total games</strong> ' + (u.totalGames ?? 0) + '</p>' +
        '<p><strong>Wins</strong> ' + (u.wins ?? 0) + '</p>' +
        '<p><strong>Status</strong> ' + (u.banned ? 'Banned' : 'Active') + '</p>';
      el.userModalBan.style.display = u.banned ? 'none' : '';
      el.userModalUnban.style.display = u.banned ? '' : 'none';
      el.userModalSave.style.display = 'none';
      if (el.userModalDelete) {
        el.userModalDelete.style.display = u.role === 'admin' ? 'none' : '';
      }
      el.userModal.classList.remove('hidden');
    } catch (e) {
      el.userModalBody.textContent = 'Failed to load user.';
      el.userModalBan.style.display = 'none';
      el.userModalUnban.style.display = 'none';
      el.userModalSave.style.display = 'none';
      if (el.userModalDelete) el.userModalDelete.style.display = 'none';
      el.userModal.classList.remove('hidden');
      showNotification(e.message || 'Failed to load user.', 'error');
    }
  }

  function doDeleteUser() {
    if (!currentModalUser) return;
    var username = currentModalUser;
    hideConfirmModal();
    api.deleteUser(username).then(function () {
      el.userModal.classList.add('hidden');
      currentModalUser = null;
      loadUsers();
      loadDashboard();
      showNotification('User deleted.', 'success');
    }).catch(function (e) {
      showNotification(e.message || 'Failed to delete user.', 'error');
    });
  }

  function deleteUser() {
    if (!currentModalUser) return;
    showConfirmModal('Permanently delete user "' + currentModalUser + '"? This cannot be undone.', doDeleteUser);
  }

  async function banUser() {
    if (!currentModalUser) return;
    try {
      await api.updateUser(currentModalUser, { banned: true });
      el.userModal.classList.add('hidden');
      loadUsers();
      loadDashboard();
      showNotification('User banned.', 'success');
    } catch (e) {
      showNotification(e.message || 'Failed to ban user.', 'error');
    }
  }

  async function unbanUser() {
    if (!currentModalUser) return;
    try {
      await api.updateUser(currentModalUser, { banned: false });
      el.userModal.classList.add('hidden');
      loadUsers();
      loadDashboard();
      showNotification('User unbanned.', 'success');
    } catch (e) {
      showNotification(e.message || 'Failed to unban user.', 'error');
    }
  }

  async function loadGameConfig() {
    try {
      var config = await api.getGameConfig();
      ['easy', 'medium', 'hard'].forEach(function (diff) {
        var c = config[diff];
        if (!c) return;
        var rounds = el.gameConfigForm.querySelector('input[name="' + diff + '.rounds"]');
        var time = el.gameConfigForm.querySelector('input[name="' + diff + '.time"]');
        var retries = el.gameConfigForm.querySelector('input[name="' + diff + '.retries"]');
        var pointsBase = el.gameConfigForm.querySelector('input[name="' + diff + '.pointsBase"]');
        var bonusPerSecond = el.gameConfigForm.querySelector('input[name="' + diff + '.bonusPerSecond"]');
        if (rounds) rounds.value = c.rounds ?? 5;
        if (time) time.value = c.time ?? 90;
        if (retries) retries.value = c.retries ?? 6;
        if (pointsBase) pointsBase.value = c.pointsBase ?? 100;
        if (bonusPerSecond) bonusPerSecond.value = c.bonusPerSecond ?? 2;
      });
    } catch (e) {
      showNotification(e.message || 'Could not load game settings.', 'error');
    }
  }

  function getGameConfigFromForm() {
    var config = { easy: {}, medium: {}, hard: {} };
    ['easy', 'medium', 'hard'].forEach(function (diff) {
      config[diff] = {
        label: diff.charAt(0).toUpperCase() + diff.slice(1),
        class: diff,
        rounds: parseInt(el.gameConfigForm.querySelector('input[name="' + diff + '.rounds"]').value, 10) || 5,
        time: parseInt(el.gameConfigForm.querySelector('input[name="' + diff + '.time"]').value, 10) || 90,
        retries: parseInt(el.gameConfigForm.querySelector('input[name="' + diff + '.retries"]').value, 10) || 6,
        pointsBase: parseInt(el.gameConfigForm.querySelector('input[name="' + diff + '.pointsBase"]').value, 10) || 100,
        bonusPerSecond: parseFloat(el.gameConfigForm.querySelector('input[name="' + diff + '.bonusPerSecond"]').value) || 2
      };
    });
    return config;
  }

  async function saveGameConfig(e) {
    e.preventDefault();
    if (el.gameConfigError) el.gameConfigError.textContent = '';
    el.gameConfigSave.disabled = true;
    try {
      var config = getGameConfigFromForm();
      await api.saveGameConfig(config);
      showNotification('Game settings saved.', 'success');
    } catch (err) {
      showNotification(err.message || 'Failed to save game settings.', 'error');
    } finally {
      el.gameConfigSave.disabled = false;
    }
  }

  async function init() {
    var allowed = await checkAccess();
    if (!allowed) return;

    el.tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        switchTab(t.getAttribute('data-tab'));
        if (t.getAttribute('data-tab') === 'dashboard') loadDashboard();
        if (t.getAttribute('data-tab') === 'users') loadUsers();
        if (t.getAttribute('data-tab') === 'game') loadGameConfig();
      });
    });

    document.getElementById('admin-logout').addEventListener('click', function () {
      api.logout().then(function () { window.location.href = '/'; });
    });

    loadDashboard();
    loadUsers();
    loadGameConfig();

    if (el.usersSearch) {
      el.usersSearch.addEventListener('input', function () {
        renderUsersTable(usersList);
      });
    }

    el.userModalClose.addEventListener('click', function () {
      el.userModal.classList.add('hidden');
    });
    el.userModal.addEventListener('click', function (ev) {
      if (ev.target === el.userModal) el.userModal.classList.add('hidden');
    });
    el.userModalBan.addEventListener('click', banUser);
    el.userModalUnban.addEventListener('click', unbanUser);
    if (el.userModalDelete) el.userModalDelete.addEventListener('click', deleteUser);

    if (el.confirmCancel) el.confirmCancel.addEventListener('click', hideConfirmModal);
    if (el.confirmDelete) el.confirmDelete.addEventListener('click', function () {
      if (typeof confirmCallback === 'function') confirmCallback();
    });
    if (el.confirmModal) el.confirmModal.addEventListener('click', function (ev) {
      if (ev.target === el.confirmModal) hideConfirmModal();
    });

    el.gameConfigForm.addEventListener('submit', saveGameConfig);
  }

  init();
})();
