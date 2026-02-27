/**
 * Banana Challenge Arena — Game UI & State
 * Handles: login, signup, profile, home, play, end; achievements; leaderboard.
 */

(function () {
  'use strict';

  const STORAGE_KEY_USER = 'bananaQuestUser';
  const STORAGE_KEY_GAME = 'bananaQuestGame';

  // ========== CONFIG ==========
  const ROUNDS_PER_GAME = 5;
  const TIME_EASY = 90;
  const TIME_MEDIUM = 60;
  const TIME_HARD = 30;
  const POINTS_EASY = 100;
  const POINTS_MEDIUM = 150;
  const POINTS_HARD = 200;
  const BONUS_PER_SEC_EASY = 2;
  const BONUS_PER_SEC_MEDIUM = 3;
  const BONUS_PER_SEC_HARD = 5;

  // ========== API HELPERS (cookie-based auth; credentials: 'include' sends cookies) ==========
  function jsonHeaders() {
    return { 'Content-Type': 'application/json' };
  }

  async function apiRefresh() {
    var res = await fetch('/api/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(),
      body: JSON.stringify({})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error || 'Session expired.');
    }
    return data;
  }

  async function apiMe() {
    var res = await fetch('/api/me', { credentials: 'include' });
    if (res.status === 401 || res.status === 404) return null;
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) throw new Error((data && data.error) || 'Failed to load session.');
    return data;
  }

  async function apiLogout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  }

  async function apiSignupSendOtp(username, email, password) {
    var res = await fetch('/api/signup/send-otp', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(),
      body: JSON.stringify({ username, email, password })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send OTP.');
    }
    return data;
  }

  async function apiSignupVerifyOtp(username, email, otp) {
    var res = await fetch('/api/signup/verify-otp', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(),
      body: JSON.stringify({ username, email, otp })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify OTP.');
    }
    return data;
  }

  async function apiLogin(usernameOrEmail, password) {
    var res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(),
      body: JSON.stringify({ usernameOrEmail: usernameOrEmail, password: password })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error || 'Invalid username or password.');
    }
    return data;
  }

  async function apiGetUser(username) {
    var url = '/api/users/' + encodeURIComponent(username);
    var res = await fetch(url, { credentials: 'include', headers: jsonHeaders() });
    if (res.status === 404) return null;
    if (res.status === 401) {
      try {
        var refreshed = await apiRefresh();
        if (refreshed) Object.assign(user, refreshed);
        try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user)); } catch (e) {}
        res = await fetch(url, { credentials: 'include', headers: jsonHeaders() });
      } catch (refreshErr) {
        user = { username: '', email: '', totalGames: 0, highScore: 0, wins: 0, achievements: [] };
        try { localStorage.removeItem(STORAGE_KEY_USER); } catch (e) {}
        throw new Error('Session expired. Please sign in again.');
      }
    }
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      throw new Error((data && data.error) || 'Failed to load user.');
    }
    return data;
  }

  async function apiSaveUser(userObj) {
    if (!userObj || !userObj.username) return;
    var url = '/api/users/' + encodeURIComponent(userObj.username);
    var opts = { method: 'PUT', credentials: 'include', headers: jsonHeaders(), body: JSON.stringify(userObj) };
    var res = await fetch(url, opts);
    if (res.status === 401) {
      try {
        var refreshed = await apiRefresh();
        if (refreshed) Object.assign(user, refreshed);
        try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user)); } catch (e) {}
        res = await fetch(url, opts);
      } catch (refreshErr) {
        user = { username: '', email: '', totalGames: 0, highScore: 0, wins: 0, achievements: [] };
        try { localStorage.removeItem(STORAGE_KEY_USER); } catch (e) {}
        throw new Error('Session expired. Please sign in again.');
      }
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save user.');
    }
    return data;
  }

  async function apiUpdateUsername(newUsername) {
    var currentUsername = (user && user.username) || '';
    if (!currentUsername) throw new Error('Not logged in.');
    var url = '/api/users/' + encodeURIComponent(currentUsername);
    var opts = {
      method: 'PUT',
      credentials: 'include',
      headers: jsonHeaders(),
      body: JSON.stringify({ username: newUsername.trim().toLowerCase() })
    };
    var res = await fetch(url, opts);
    if (res.status === 401) {
      var refreshed = await apiRefresh();
      if (refreshed) Object.assign(user, refreshed);
      try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user)); } catch (e) {}
      res = await fetch(url, opts);
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update username.');
    }
    return data;
  }

  async function apiGetLeaderboard() {
    var res = await fetch('/api/leaderboard', { credentials: 'include' });
    var data = await res.json().catch(function () { return []; });
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load leaderboard.');
    }
    return data;
  }

  // Fetch a fresh Banana puzzle from the backend proxy.
  async function apiBananaQuestion() {
    var res = await fetch('/api/banana-question', { credentials: 'include' });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data) {
      throw new Error((data && data.error) || 'Failed to load banana puzzle.');
    }
    return data;
  }

  // Utility: shuffle an array (Fisher–Yates).
  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  // Build multiple-choice answers around the numeric Banana solution.
  function buildChoicesFromSolution(solution) {
    var correct = Number(solution);
    if (!isFinite(correct)) {
      correct = parseInt(solution, 10) || 0;
    }
    var answers = [correct];
    var deltas = [-3, -2, -1, 1, 2, 3, 4, 5];
    for (var i = 0; i < deltas.length && answers.length < 4; i++) {
      var candidate = correct + deltas[i];
      if (candidate >= 0 && answers.indexOf(candidate) === -1) {
        answers.push(candidate);
      }
    }
    var step = 1;
    while (answers.length < 4) {
      var up = correct + step;
      if (answers.indexOf(up) === -1) answers.push(up);
      if (answers.length >= 4) break;
      var down = correct - step;
      if (down >= 0 && answers.indexOf(down) === -1) answers.push(down);
      step += 1;
    }
    answers = shuffleArray(answers);
    var correctIndex = answers.indexOf(correct);
    return {
      answers: answers.map(function (n) { return String(n); }),
      correctIndex: correctIndex < 0 ? 0 : correctIndex
    };
  }

  // Load N Banana puzzles and convert them into internal question objects.
  async function loadBananaQuestions(count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      try {
        var data = await apiBananaQuestion();
        var choices = buildChoicesFromSolution(data.solution);
        out.push({
          question: 'Solve the banana puzzle',
          imageUrl: data.question,
          answers: choices.answers,
          correct: choices.correctIndex,
          solution: data.solution
        });
      } catch (err) {
        console.error('Failed to fetch banana puzzle', err);
        break;
      }
    }
    return out;
  }

  const RETRIES_EASY = 6;
  const RETRIES_MEDIUM = 4;
  const RETRIES_HARD = 2;

  const DIFFICULTY_CONFIG = {
    easy:   { label: 'Easy',   time: TIME_EASY,   class: 'easy',   retries: RETRIES_EASY,   pointsBase: POINTS_EASY,   bonusPerSecond: BONUS_PER_SEC_EASY },
    medium: { label: 'Medium', time: TIME_MEDIUM, class: 'medium', retries: RETRIES_MEDIUM, pointsBase: POINTS_MEDIUM, bonusPerSecond: BONUS_PER_SEC_MEDIUM },
    hard:   { label: 'Hard',   time: TIME_HARD,   class: 'hard',   retries: RETRIES_HARD,   pointsBase: POINTS_HARD,   bonusPerSecond: BONUS_PER_SEC_HARD }
  };

  // Achievements: id, name, description, icon. Unlocked by levels / score / wins.
  const ACHIEVEMENTS = [
    { id: 'first_game', name: 'First Steps', description: 'Complete your first game', icon: '🎮' },
    { id: 'level_1', name: 'Round One', description: 'Complete round 1', icon: '1️⃣' },
    { id: 'level_2', name: 'Getting Warm', description: 'Complete 2 rounds in one game', icon: '2️⃣' },
    { id: 'level_3', name: 'Halfway There', description: 'Complete 3 rounds in one game', icon: '3️⃣' },
    { id: 'level_4', name: 'Almost There', description: 'Complete 4 rounds in one game', icon: '4️⃣' },
    { id: 'level_5', name: 'Full Run', description: 'Complete all 5 rounds', icon: '5️⃣' },
    { id: 'first_win', name: 'First Win', description: 'Get every question right in a game', icon: '🏆' },
    { id: 'perfect_easy', name: 'Easy Master', description: 'Perfect score on Easy', icon: '🌱' },
    { id: 'perfect_medium', name: 'Medium Master', description: 'Perfect score on Medium', icon: '⚡' },
    { id: 'perfect_hard', name: 'Hard Master', description: 'Perfect score on Hard', icon: '🔥' },
    { id: 'score_500', name: 'Score 500', description: 'Reach 500 points in a game', icon: '⭐' },
    { id: 'score_1000', name: 'Score 1000', description: 'Reach 1000 points in a game', icon: '🌟' },
    { id: 'three_wins', name: 'Triple Win', description: 'Win 3 games', icon: '🥇' },
    { id: 'ten_games', name: 'Veteran', description: 'Play 10 games', icon: '🎖️' },
    { id: 'speed_demon', name: 'Speed Demon', description: 'Answer with 30+ seconds left on Hard', icon: '⚡' }
  ];

  // Mock questions for UI demo (replace with Banana API later)
  const MOCK_QUESTIONS = [
    { question: 'What is the capital of France?', answers: ['London', 'Paris', 'Berlin', 'Madrid'], correct: 1 },
    { question: 'Which planet is known as the Red Planet?', answers: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correct: 1 },
    { question: 'How many continents are there?', answers: ['5', '6', '7', '8'], correct: 2 },
    { question: 'What is 15 × 4?', answers: ['50', '55', '60', '65'], correct: 2 },
    { question: 'Which element has the chemical symbol Au?', answers: ['Silver', 'Copper', 'Gold', 'Aluminum'], correct: 2 }
  ];

  // ========== STATE ==========
  let user = {
    username: '',
    email: '',
    totalGames: 0,
    highScore: 0,
    wins: 0,
    achievements: []
  };

  var lastGameWasNewBest = false;

  let gameState = {
    difficulty: null,
    roundTime: 0,
    currentRound: 0,
    totalRounds: ROUNDS_PER_GAME,
    score: 0,
    correctCount: 0,
    timeLeft: 0,
    roundStartedAt: null,
    timerId: null,
    questions: [],
    selectedAnswerIndex: null,
    answered: false,
    lives: 0,
    maxLives: 6
  };

  // ========== DOM REFS ==========
  const screens = {
    splash: document.getElementById('screen-splash'),
    login: document.getElementById('screen-login'),
    profile: document.getElementById('screen-profile'),
    home: document.getElementById('screen-home'),
    play: document.getElementById('screen-play'),
    end: document.getElementById('screen-end')
  };

  const elements = {
    formLogin: document.getElementById('form-login'),
    formSignup: document.getElementById('form-signup'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    signupUsername: document.getElementById('signup-username'),
    signupEmail: document.getElementById('signup-email'),
    signupPassword: document.getElementById('signup-password'),
    signupConfirm: document.getElementById('signup-confirm'),
    signupError: document.getElementById('signup-error'),
    signupStep1: document.getElementById('signup-step1'),
    signupStep2: document.getElementById('signup-step2'),
    signupOtp: document.getElementById('signup-otp'),
    signupOtpError: document.getElementById('signup-otp-error'),
    loginError: document.getElementById('login-error'),
    btnLoginSubmit: document.getElementById('btn-login-submit'),
    btnSignupSendOtp: document.getElementById('btn-signup-send-otp'),
    btnSignupVerify: document.getElementById('btn-signup-verify'),
    profileName: document.getElementById('profile-name'),
    profileEmail: document.getElementById('profile-email'),
    profileAvatar: document.getElementById('profile-avatar'),
    profileTotalGames: document.getElementById('profile-total-games'),
    profileHighScore: document.getElementById('profile-high-score'),
    profileWins: document.getElementById('profile-wins'),
    profileLevel: document.getElementById('profile-level'),
    profileXpFill: document.getElementById('profile-xp-fill'),
    profileXpText: document.getElementById('profile-xp-text'),
    profileWinrate: document.getElementById('profile-winrate'),
    profileAchievementsCount: document.getElementById('profile-achievements-count'),
    profileAchievements: document.getElementById('profile-achievements'),
    editUsernameModal: document.getElementById('edit-username-modal'),
    editUsernameInput: document.getElementById('edit-username-input'),
    editUsernameError: document.getElementById('edit-username-error'),
    formEditUsername: document.getElementById('form-edit-username'),
    btnEditUsernameCancel: document.getElementById('btn-edit-username-cancel'),
    btnEditUsernameSave: document.getElementById('btn-edit-username-save'),
    homeUsername: document.getElementById('home-username'),
    homeScore: document.getElementById('home-score'),
    homeBest: document.getElementById('home-best'),
    leaderboardList: document.getElementById('leaderboard-list'),
    difficultyCards: document.querySelectorAll('.difficulty-card'),
    btnStartGame: document.getElementById('btn-start-game'),
    roundNumber: document.getElementById('round-number'),
    roundTotal: document.getElementById('round-total'),
    timerProgress: document.getElementById('timer-progress'),
    timerDisplay: document.getElementById('timer-display'),
    playScore: document.getElementById('play-score'),
    playDifficulty: document.getElementById('play-difficulty'),
    livesWrap: document.getElementById('lives-wrap'),
    livesFill: document.getElementById('lives-fill'),
    livesText: document.getElementById('lives-text'),
    questionCardWrapper: document.getElementById('question-card-wrapper'),
    questionCard: document.getElementById('question-card'),
    questionCardCrack: document.getElementById('question-card-crack'),
    questionText: document.getElementById('question-text'),
    questionMedia: document.getElementById('question-media'),
    answersContainer: document.getElementById('answers-container'),
    btnSubmitAnswer: document.getElementById('btn-submit-answer'),
    feedbackFloating: document.getElementById('feedback-floating'),
    correctBadge: document.getElementById('correct-badge'),
    confettiContainer: document.getElementById('confetti-container'),
    screenFlash: document.getElementById('screen-flash'),
    feedbackToast: document.getElementById('feedback-toast'),
    endIcon: document.getElementById('end-icon'),
    endTitle: document.getElementById('end-title'),
    endMessage: document.getElementById('end-message'),
    endScore: document.getElementById('end-score'),
    endCorrect: document.getElementById('end-correct'),
    endRounds: document.getElementById('end-rounds'),
    btnPlayAgain: document.getElementById('btn-play-again'),
    btnBackHome: document.getElementById('btn-back-home')
  };

  // ========== SCREEN NAVIGATION ==========
  function showScreen(screenId) {
    Object.keys(screens).forEach(function (id) {
      screens[id].classList.toggle('active', id === screenId);
    });
  }

  function bindNavButtons() {
    document.querySelectorAll('.nav-btn[data-screen]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = this.getAttribute('data-screen');
        if (target === 'home') showScreen('home');
        if (target === 'profile') showScreen('profile');
        document.querySelectorAll('.nav-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-screen') === target);
        });
      });
    });

    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-logout-2').addEventListener('click', handleLogout);
  }

  async function handleLogout() {
    apiLogout().catch(function () {});
    clearGameState();
    user = { username: '', email: '', totalGames: 0, highScore: 0, wins: 0, achievements: [] };
    try { localStorage.removeItem(STORAGE_KEY_USER); } catch (e) {}
    showScreen('login');
    elements.formLogin.reset();
    showAuthForm('login');
  }

  // ========== STORAGE (persist profile to MongoDB + localStorage; auth via cookies) ==========
  function saveCurrentUserToRegistry() {
    if (!user.username) return;
    apiSaveUser(user).catch(function (err) {
      console.error('Failed to save user to database', err);
    });
    try {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify({
        username: user.username,
        email: user.email,
        highScore: user.highScore,
        totalGames: user.totalGames,
        wins: user.wins,
        achievements: user.achievements || []
      }));
    } catch (e) {}
  }

  // ========== AUTH TOGGLE ==========
  function showAuthForm(formId) {
    var isLogin = formId === 'login';
    elements.formLogin.classList.toggle('hidden', !isLogin);
    elements.formSignup.classList.toggle('hidden', isLogin);
    if (elements.signupError) elements.signupError.textContent = '';
    if (elements.signupOtpError) elements.signupOtpError.textContent = '';
    if (elements.signupStep1) elements.signupStep1.classList.remove('hidden');
    if (elements.signupStep2) elements.signupStep2.classList.add('hidden');
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('loading', loading);
  }

  // ========== SIGNUP (step 1: send OTP → step 2: verify OTP) ==========
  async function handleSignupSubmit(e) {
    e.preventDefault();
    if (elements.signupOtpError) elements.signupOtpError.textContent = '';
    if (elements.signupError) elements.signupError.textContent = '';

    if (elements.signupStep2 && !elements.signupStep2.classList.contains('hidden')) {
      var username = (elements.signupUsername.value || '').trim().toLowerCase();
      var email = (elements.signupEmail.value || '').trim();
      var otp = (elements.signupOtp.value || '').trim();
      if (!otp || otp.length !== 6) {
        if (elements.signupOtpError) elements.signupOtpError.textContent = 'Enter the 6-digit code from your email.';
        return;
      }
      setButtonLoading(elements.btnSignupVerify, true);
      try {
        var created = await apiSignupVerifyOtp(username, email, otp);
        user = {
          username: created.username,
          email: created.email,
          totalGames: created.totalGames || 0,
          highScore: created.highScore || 0,
          wins: created.wins || 0,
          achievements: created.achievements || []
        };
        saveCurrentUserToRegistry();
        updateProfileUI();
        updateHomeUI();
        renderLeaderboard();
        showScreen('home');
        bindNavButtons();
        if (elements.signupStep1) elements.signupStep1.classList.remove('hidden');
        if (elements.signupStep2) elements.signupStep2.classList.add('hidden');
        if (elements.signupOtp) elements.signupOtp.value = '';
      } catch (err) {
        if (elements.signupOtpError) {
          elements.signupOtpError.textContent = err.message || 'Invalid or expired OTP.';
        }
      } finally {
        setButtonLoading(elements.btnSignupVerify, false);
      }
      return;
    }

    var username = (elements.signupUsername.value || '').trim().toLowerCase();
    var email = (elements.signupEmail.value || '').trim();
    var password = elements.signupPassword.value;
    var confirm = elements.signupConfirm.value;

    if (username.length < 2) {
      if (elements.signupError) elements.signupError.textContent = 'Username must be at least 2 characters.';
      return;
    }
    if (!email) {
      if (elements.signupError) elements.signupError.textContent = 'Email is required.';
      return;
    }
    if (password.length < 6) {
      if (elements.signupError) elements.signupError.textContent = 'Password must be at least 6 characters.';
      return;
    }
    if (password !== confirm) {
      if (elements.signupError) elements.signupError.textContent = 'Passwords do not match.';
      return;
    }
    setButtonLoading(elements.btnSignupSendOtp, true);
    try {
      await apiSignupSendOtp(username, email, password);
      if (elements.signupError) elements.signupError.textContent = '';
      if (elements.signupStep1) elements.signupStep1.classList.add('hidden');
      if (elements.signupStep2) elements.signupStep2.classList.remove('hidden');
      if (elements.signupOtp) elements.signupOtp.value = '';
      if (elements.signupOtpError) elements.signupOtpError.textContent = '';
    } catch (err) {
      if (elements.signupError) {
        elements.signupError.textContent = err.message || 'Failed to send OTP.';
      }
    } finally {
      setButtonLoading(elements.btnSignupSendOtp, false);
    }
  }

  // ========== LOGIN ==========
  async function handleLoginSubmit(e) {
    e.preventDefault();
    var usernameOrEmail = (elements.loginUsername.value || '').trim();
    var password = elements.loginPassword.value;
    if (!usernameOrEmail) return;
    setButtonLoading(elements.btnLoginSubmit, true);
    try {
      var loggedIn = await apiLogin(usernameOrEmail, password);
      if (elements.loginError) elements.loginError.textContent = '';

      user = {
        username: loggedIn.username,
        email: loggedIn.email,
        totalGames: loggedIn.totalGames || 0,
        highScore: loggedIn.highScore || 0,
        wins: loggedIn.wins || 0,
        achievements: loggedIn.achievements || []
      };
      saveCurrentUserToRegistry();
      updateProfileUI();
      updateHomeUI();
      renderLeaderboard();
      showScreen('home');
      bindNavButtons();
    } catch (err) {
      if (elements.loginError) {
        elements.loginError.textContent = err.message || 'Invalid username or password.';
      }
    } finally {
      setButtonLoading(elements.btnLoginSubmit, false);
    }
  }

  function applyUserPayload(payload) {
    if (!payload) return;
    user.username = payload.username;
    user.email = payload.email || '';
    user.totalGames = payload.totalGames || 0;
    user.highScore = payload.highScore || 0;
    user.wins = payload.wins || 0;
    user.achievements = Array.isArray(payload.achievements) ? payload.achievements : [];
  }

  function getProfileLevelAndXp() {
    var games = user.totalGames || 0;
    var score = user.highScore || 0;
    var totalXp = games * 25 + Math.floor(score / 10);
    var xpPerLevel = 100;
    var level = 1 + Math.floor(totalXp / xpPerLevel);
    level = Math.min(level, 99);
    var xpInLevel = totalXp % xpPerLevel;
    return { level: level, xpInLevel: xpInLevel, xpPerLevel: xpPerLevel };
  }

  function updateProfileUI() {
    elements.profileName.textContent = user.username;
    elements.profileEmail.textContent = user.email;
    elements.profileAvatar.textContent = (user.username.charAt(0) || '?').toUpperCase();
    elements.profileTotalGames.textContent = user.totalGames;
    elements.profileHighScore.textContent = user.highScore;
    elements.profileWins.textContent = user.wins;
    var winrate = user.totalGames ? Math.round((user.wins / user.totalGames) * 100) : 0;
    if (elements.profileWinrate) elements.profileWinrate.textContent = winrate + '%';
    var levelData = getProfileLevelAndXp();
    if (elements.profileLevel) elements.profileLevel.textContent = levelData.level;
    if (elements.profileXpFill) elements.profileXpFill.style.width = levelData.xpInLevel + '%';
    if (elements.profileXpText) elements.profileXpText.textContent = levelData.xpInLevel + ' / ' + levelData.xpPerLevel + ' XP';
    var count = (user.achievements || []).length;
    if (elements.profileAchievementsCount) elements.profileAchievementsCount.textContent = count + ' / 15';
    renderProfileAchievements();
  }

  function showEditUsernameModal() {
    if (!user.username) return;
    if (elements.editUsernameModal) elements.editUsernameModal.classList.remove('hidden');
    if (elements.editUsernameModal) elements.editUsernameModal.setAttribute('aria-hidden', 'false');
    if (elements.editUsernameInput) {
      elements.editUsernameInput.value = user.username;
      elements.editUsernameInput.focus();
    }
    if (elements.editUsernameError) elements.editUsernameError.textContent = '';
  }

  function hideEditUsernameModal() {
    if (elements.editUsernameModal) elements.editUsernameModal.classList.add('hidden');
    if (elements.editUsernameModal) elements.editUsernameModal.setAttribute('aria-hidden', 'true');
    if (elements.editUsernameError) elements.editUsernameError.textContent = '';
  }

  async function handleEditUsernameSubmit(e) {
    e.preventDefault();
    var newUsername = (elements.editUsernameInput && elements.editUsernameInput.value || '').trim().toLowerCase();
    if (!newUsername || newUsername.length < 2) {
      if (elements.editUsernameError) elements.editUsernameError.textContent = 'Username must be at least 2 characters.';
      return;
    }
    if (newUsername === user.username) {
      hideEditUsernameModal();
      return;
    }
    setButtonLoading(elements.btnEditUsernameSave, true);
    if (elements.editUsernameError) elements.editUsernameError.textContent = '';
    try {
      var updated = await apiUpdateUsername(newUsername);
      applyUserPayload(updated);
      saveCurrentUserToRegistry();
      try {
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify({
          username: user.username,
          email: user.email,
          highScore: user.highScore,
          totalGames: user.totalGames,
          wins: user.wins,
          achievements: user.achievements || []
        }));
      } catch (err) {}
      updateProfileUI();
      updateHomeUI();
      renderLeaderboard();
      hideEditUsernameModal();
    } catch (err) {
      if (elements.editUsernameError) {
        elements.editUsernameError.textContent = err.message || 'Failed to update username.';
      }
    } finally {
      setButtonLoading(elements.btnEditUsernameSave, false);
    }
  }

  function updateHomeUI() {
    elements.homeUsername.textContent = user.username;
    elements.homeScore.textContent = gameState.score;
    elements.homeBest.textContent = user.highScore;
    renderLeaderboard();
  }

  // ========== ACHIEVEMENTS ==========
  function grantAchievement(id) {
    var unlocked = user.achievements || [];
    if (unlocked.indexOf(id) === -1) {
      unlocked.push(id);
      user.achievements = unlocked;
      saveCurrentUserToRegistry();
      try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user)); } catch (e) {}
    }
  }

  function checkAchievements() {
    var unlocked = user.achievements || [];
    var added = [];

    function grant(id) {
      if (unlocked.indexOf(id) === -1) {
        unlocked.push(id);
        added.push(id);
      }
    }

    if (user.totalGames >= 1) grant('first_game');
    if (gameState.currentRound >= 1) grant('level_1');
    if (gameState.currentRound >= 2) grant('level_2');
    if (gameState.currentRound >= 3) grant('level_3');
    if (gameState.currentRound >= 4) grant('level_4');
    if (gameState.currentRound >= gameState.totalRounds && gameState.totalRounds >= 5) grant('level_5');
    if (gameState.correctCount === gameState.totalRounds) {
      grant('first_win');
      if (gameState.difficulty === 'easy') grant('perfect_easy');
      if (gameState.difficulty === 'medium') grant('perfect_medium');
      if (gameState.difficulty === 'hard') grant('perfect_hard');
    }
    if (gameState.score >= 500) grant('score_500');
    if (gameState.score >= 1000) grant('score_1000');
    if (user.wins >= 3) grant('three_wins');
    if (user.totalGames >= 10) grant('ten_games');

    user.achievements = unlocked;
    saveCurrentUserToRegistry();
    try {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    } catch (e) {}
    return added;
  }

  function renderProfileAchievements() {
    if (!elements.profileAchievements) return;
    var list = ACHIEVEMENTS.map(function (a) {
      var unlocked = (user.achievements || []).indexOf(a.id) !== -1;
      return (
        '<div class="achievement-item ' + (unlocked ? 'unlocked' : 'locked') + '" title="' + escapeHtml(a.description) + '">' +
          '<span class="achievement-icon">' + a.icon + '</span>' +
          '<span class="achievement-name">' + escapeHtml(a.name) + '</span>' +
          '<span class="achievement-desc">' + escapeHtml(a.description) + '</span>' +
        '</div>'
      );
    }).join('');
    elements.profileAchievements.innerHTML = list;
  }

  // ========== LEADERBOARD ==========
  function renderLeaderboard() {
    if (!elements.leaderboardList) return;
    apiGetLeaderboard()
      .then(function (top) {
        if (!top || top.length === 0) {
          elements.leaderboardList.innerHTML = '<p class="leaderboard-empty">No scores yet. Play to climb the board!</p>';
          return;
        }
        elements.leaderboardList.innerHTML = top.map(function (row, i) {
          var rank = i + 1;
          var isYou = user.username && row.username === user.username;
          return (
            '<div class="leaderboard-row rank-' + rank + (isYou ? ' you' : '') + '">' +
              '<span class="leaderboard-rank">#' + rank + '</span>' +
              '<span class="leaderboard-name">' + escapeHtml(row.username) + (isYou ? ' (you)' : '') + '</span>' +
              '<span class="leaderboard-score">' + row.highScore + '</span>' +
            '</div>'
          );
        }).join('');
      })
      .catch(function (err) {
        console.error('Failed to load leaderboard', err);
        elements.leaderboardList.innerHTML = '<p class="leaderboard-empty">Unable to load leaderboard.</p>';
      });
  }

  // ========== GAME STATE PERSISTENCE (survive refresh) ==========
  function saveGameState() {
    if (!gameState.difficulty || !gameState.questions || gameState.questions.length === 0) return;
    try {
      var payload = {
        difficulty: gameState.difficulty,
        currentRound: gameState.currentRound,
        totalRounds: gameState.totalRounds,
        score: gameState.score,
        correctCount: gameState.correctCount,
        lives: gameState.lives,
        maxLives: gameState.maxLives,
        roundTime: gameState.roundTime,
        roundStartedAt: gameState.roundStartedAt,
        questions: gameState.questions
      };
      sessionStorage.setItem(STORAGE_KEY_GAME, JSON.stringify(payload));
    } catch (e) {}
  }

  function clearGameState() {
    try {
      sessionStorage.removeItem(STORAGE_KEY_GAME);
    } catch (e) {}
  }

  function tryRestoreGame() {
    if (!user || !user.username) return false;
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY_GAME);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.difficulty || data.currentRound >= data.totalRounds || !data.questions || !data.questions.length) {
        clearGameState();
        return false;
      }
      gameState.difficulty = data.difficulty;
      gameState.currentRound = data.currentRound;
      gameState.totalRounds = data.totalRounds;
      gameState.score = data.score || 0;
      gameState.correctCount = data.correctCount || 0;
      gameState.lives = data.lives != null ? data.lives : data.maxLives;
      gameState.maxLives = data.maxLives || 6;
      gameState.roundTime = data.roundTime || DIFFICULTY_CONFIG[data.difficulty].time;
      gameState.questions = data.questions;
      gameState.answered = false;
      gameState.selectedAnswerIndex = null;
      gameState.roundStartedAt = data.roundStartedAt || Date.now();
      var elapsed = (Date.now() - gameState.roundStartedAt) / 1000;
      gameState.timeLeft = Math.max(0, Math.ceil(gameState.roundTime - elapsed));
      return true;
    } catch (e) {
      clearGameState();
      return false;
    }
  }

  function restoreRound() {
    var round = gameState.currentRound;
    var total = gameState.totalRounds;
    var q = gameState.questions[round];
    var config = DIFFICULTY_CONFIG[gameState.difficulty];

    elements.roundNumber.textContent = round + 1;
    elements.roundTotal.textContent = total;
    elements.playScore.textContent = gameState.score;
    updateLivesUI();
    elements.playDifficulty.textContent = config.label;
    elements.playDifficulty.className = 'difficulty-badge ' + config.class;

    elements.questionCard.classList.remove('card-correct', 'card-wrong');
    if (elements.questionCardCrack) elements.questionCardCrack.classList.remove('show');
    if (elements.questionCardWrapper) elements.questionCardWrapper.classList.remove('slide-out', 'slide-in');
    if (elements.confettiContainer) elements.confettiContainer.innerHTML = '';
    if (elements.correctBadge) elements.correctBadge.classList.remove('show');
    if (elements.feedbackFloating) elements.feedbackFloating.textContent = '';

    renderQuestionContent(q);
    elements.btnSubmitAnswer.disabled = true;

    startTimer();
    saveGameState();
  }

  // ========== DIFFICULTY & START GAME ==========
  function selectDifficulty(difficulty) {
    gameState.difficulty = difficulty;
    elements.difficultyCards.forEach(function (card) {
      card.classList.toggle('selected', card.getAttribute('data-difficulty') === difficulty);
    });
    elements.btnStartGame.disabled = false;
    elements.btnStartGame.textContent = 'Start game';
  }

  async function startGame() {
    if (!gameState.difficulty) return;

    var config = DIFFICULTY_CONFIG[gameState.difficulty];
    gameState.roundTime = config.time;
    gameState.currentRound = 0;
    gameState.totalRounds = ROUNDS_PER_GAME;
    gameState.score = 0;
    gameState.correctCount = 0;
    gameState.maxLives = config.retries || 6;
    gameState.lives = gameState.maxLives;

    elements.btnStartGame.disabled = true;
    elements.btnStartGame.textContent = 'Loading Banana puzzles...';

    try {
      var questions = await loadBananaQuestions(ROUNDS_PER_GAME);
      if (!questions || !questions.length) {
        throw new Error('No puzzles loaded.');
      }
      gameState.questions = questions;
      gameState.totalRounds = questions.length;

      user.totalGames += 1;
      saveCurrentUserToRegistry();
      try {
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      } catch (errStore) {}

      showScreen('play');
      runRound();
      saveGameState();
    } catch (err) {
      console.error('Failed to start game with Banana API', err);
      window.alert('Unable to load Banana puzzles right now. Please try again.');
    } finally {
      elements.btnStartGame.disabled = false;
      elements.btnStartGame.textContent = 'Start game';
    }
  }

  // ========== ROUND & TIMER ==========
  function runRound() {
    gameState.answered = false;
    gameState.selectedAnswerIndex = null;
    gameState.lives = gameState.maxLives;

    var round = gameState.currentRound;
    var total = gameState.totalRounds;
    var q = gameState.questions[round];

    elements.roundNumber.textContent = round + 1;
    elements.roundTotal.textContent = total;
    elements.playScore.textContent = gameState.score;
    updateLivesUI();

    var config = DIFFICULTY_CONFIG[gameState.difficulty];
    elements.playDifficulty.textContent = config.label;
    elements.playDifficulty.className = 'difficulty-badge ' + config.class;

    elements.questionCard.classList.remove('card-correct', 'card-wrong');
    elements.questionCardCrack.classList.remove('show');
    if (elements.questionCardWrapper) elements.questionCardWrapper.classList.remove('slide-out', 'slide-in');
    if (elements.confettiContainer) elements.confettiContainer.innerHTML = '';
    if (elements.correctBadge) elements.correctBadge.classList.remove('show');
    if (elements.feedbackFloating) elements.feedbackFloating.textContent = '';

    renderQuestionContent(q);
    elements.btnSubmitAnswer.disabled = true;

    gameState.timeLeft = gameState.roundTime;
    gameState.roundStartedAt = Date.now();
    startTimer();
    saveGameState();
  }

  function updateLivesUI() {
    if (!elements.livesFill || !elements.livesText) return;
    var pct = gameState.maxLives ? (gameState.lives / gameState.maxLives) * 100 : 100;
    elements.livesFill.style.width = pct + '%';
    elements.livesText.textContent = gameState.lives;
  }

  function renderAnswers(answers) {
    var circumference = 2 * Math.PI * 26;
    elements.answersContainer.innerHTML = answers.map(function (text, index) {
      return (
        '<label class="answer-option" data-index="' + index + '">' +
          '<input type="radio" name="answer" value="' + index + '">' +
          '<span class="answer-text">' + escapeHtml(text) + '</span>' +
        '</label>'
      );
    }).join('');

    elements.answersContainer.querySelectorAll('.answer-option').forEach(function (label) {
      label.addEventListener('click', function () {
        if (gameState.answered) return;
        elements.answersContainer.querySelectorAll('.answer-option').forEach(function (el) {
          el.classList.remove('selected');
        });
        label.classList.add('selected');
        label.querySelector('input').checked = true;
        gameState.selectedAnswerIndex = parseInt(label.getAttribute('data-index'), 10);
        elements.btnSubmitAnswer.disabled = false;
      });
    });
  }

  function renderQuestionContent(q) {
    elements.questionText.textContent = q && q.question ? q.question : 'Solve the banana puzzle';
    if (elements.questionMedia) {
      elements.questionMedia.innerHTML = '';
      if (q && q.imageUrl) {
        var img = document.createElement('img');
        img.src = q.imageUrl;
        img.alt = 'Banana puzzle';
        img.className = 'question-image';
        elements.questionMedia.appendChild(img);
      }
    }
    renderAnswers((q && q.answers) || []);
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function startTimer() {
    stopTimer();
    var circumference = 2 * Math.PI * 26;
    var roundTime = gameState.roundTime;

    elements.timerProgress.style.strokeDasharray = circumference;

    function updateTimer() {
      elements.timerDisplay.textContent = gameState.timeLeft;
      var offset = circumference - (gameState.timeLeft / roundTime) * circumference;
      elements.timerProgress.style.strokeDashoffset = offset;

      elements.timerProgress.classList.remove('warning', 'danger');
      if (gameState.timeLeft <= 10) elements.timerProgress.classList.add('danger');
      else if (gameState.timeLeft <= roundTime * 0.33) elements.timerProgress.classList.add('warning');

      if (gameState.timeLeft <= 0) {
        stopTimer();
        onTimeUp();
        return;
      }
      gameState.timeLeft -= 1;
    }

    updateTimer();
    gameState.timerId = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (gameState.timerId) {
      clearInterval(gameState.timerId);
      gameState.timerId = null;
    }
  }

  function onTimeUp() {
    if (gameState.answered) return;
    gameState.answered = true;
    showFeedback(false, 'Time\'s up!');
    highlightCorrectAnswer();
    scheduleNextRound(0);
  }

  // ========== SOUND (soft success / error) ==========
  function playSuccessSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 523;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  function playErrorSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 180;
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  // ========== ANIMATIONS ==========
  function showFloatingText(text, type) {
    if (!elements.feedbackFloating) return;
    elements.feedbackFloating.textContent = text;
    elements.feedbackFloating.className = 'feedback-floating show float-' + (type || 'score');
    clearTimeout(elements.feedbackFloating._floatTimeout);
    elements.feedbackFloating._floatTimeout = setTimeout(function () {
      elements.feedbackFloating.classList.remove('show');
    }, 1200);
  }

  function showCorrectBadge() {
    if (!elements.correctBadge) return;
    elements.correctBadge.classList.add('show');
    setTimeout(function () {
      elements.correctBadge.classList.remove('show');
    }, 800);
  }

  function confettiBurst() {
    if (!elements.confettiContainer) return;
    elements.confettiContainer.innerHTML = '';
    var colors = ['#ffd464', '#ffe066', '#f5c842', '#ffec8b', '#ffd700'];
    for (var i = 0; i < 24; i++) {
      var p = document.createElement('div');
      p.className = 'confetti-particle';
      p.style.setProperty('--angle', (i * 15) + 'deg');
      p.style.setProperty('--delay', (i * 0.02) + 's');
      p.style.backgroundColor = colors[i % colors.length];
      elements.confettiContainer.appendChild(p);
    }
    elements.confettiContainer.classList.add('burst');
    setTimeout(function () {
      elements.confettiContainer.classList.remove('burst');
      elements.confettiContainer.innerHTML = '';
    }, 1200);
  }

  function playCorrectAnimation(points) {
    elements.questionCard.classList.add('card-correct');
    elements.playScore.classList.add('score-pop');
    setTimeout(function () { elements.playScore.classList.remove('score-pop'); }, 500);
    showFloatingText('+' + points, 'score');
    showCorrectBadge();
    confettiBurst();
    playSuccessSound();
    showFeedback(true, '+ ' + points + ' points!');
  }

  function playWrongAnimation() {
    elements.questionCard.classList.add('card-wrong');
    if (elements.questionCardCrack) elements.questionCardCrack.classList.add('show');
    if (elements.screenFlash) {
      elements.screenFlash.classList.add('show');
      setTimeout(function () { elements.screenFlash.classList.remove('show'); }, 300);
    }
    showFloatingText('-1 Life', 'life');
    updateLivesUI();
    playErrorSound();
    showFeedback(false, 'Wrong answer');
  }

  // ========== SUBMISSION & SCORE ==========
  function handleSubmitAnswer() {
    if (gameState.answered || gameState.selectedAnswerIndex === null) return;

    gameState.answered = true;
    stopTimer();

    var q = gameState.questions[gameState.currentRound];
    var correct = gameState.selectedAnswerIndex === q.correct;
    var config = DIFFICULTY_CONFIG[gameState.difficulty];
    var basePoints = (config && config.pointsBase) || 100;
    var bonusPerSec = (config && config.bonusPerSecond) || 2;
    var bonus = gameState.timeLeft * bonusPerSec;
    var points = correct ? (basePoints + bonus) : 0;

    if (correct) {
      gameState.score += points;
      gameState.correctCount += 1;
      if (gameState.difficulty === 'hard' && gameState.timeLeft >= 30) {
        grantAchievement('speed_demon');
      }
      elements.playScore.textContent = gameState.score;
      saveGameState();
      playCorrectAnimation(points);
      highlightCorrectAnswer();
      scheduleNextRound(200);
    } else {
      gameState.lives -= 1;
      saveGameState();
      playWrongAnimation();
      highlightCorrectAnswer();
      highlightWrongAnswer(gameState.selectedAnswerIndex);
      if (gameState.lives <= 0) {
        scheduleNextRound(0);
      } else {
        gameState.answered = false;
        elements.answersContainer.querySelectorAll('.answer-option').forEach(function (el) {
          el.classList.remove('correct', 'wrong', 'selected');
          if (el.querySelector('input')) el.querySelector('input').checked = false;
        });
        gameState.selectedAnswerIndex = null;
        elements.btnSubmitAnswer.disabled = true;
        setTimeout(function () {
          if (elements.questionCardCrack) elements.questionCardCrack.classList.remove('show');
          elements.questionCard.classList.remove('card-wrong');
          startTimer();
        }, 450);
      }
    }
  }

  function highlightCorrectAnswer() {
    var q = gameState.questions[gameState.currentRound];
    var options = elements.answersContainer.querySelectorAll('.answer-option');
    if (options[q.correct]) options[q.correct].classList.add('correct');
  }

  function highlightWrongAnswer(index) {
    var options = elements.answersContainer.querySelectorAll('.answer-option');
    if (options[index]) options[index].classList.add('wrong');
  }

  function showFeedback(isCorrect, message) {
    elements.feedbackToast.textContent = message;
    elements.feedbackToast.className = 'feedback-toast show ' + (isCorrect ? 'correct' : 'wrong');
    setTimeout(function () {
      elements.feedbackToast.classList.remove('show');
    }, 2000);
  }

  function setRoundContent() {
    var round = gameState.currentRound;
    var total = gameState.totalRounds;
    var q = gameState.questions[round];
    elements.roundNumber.textContent = round + 1;
    elements.roundTotal.textContent = total;
    elements.playScore.textContent = gameState.score;
    renderQuestionContent(q);
    updateLivesUI();
    elements.questionCard.classList.remove('card-correct', 'card-wrong');
    if (elements.questionCardCrack) elements.questionCardCrack.classList.remove('show');
    if (elements.questionCardWrapper) elements.questionCardWrapper.classList.remove('slide-in', 'ready');
  }

  function scheduleNextRound(delayAfterCorrect) {
    elements.btnSubmitAnswer.disabled = true;
    var delay = typeof delayAfterCorrect === 'number' ? delayAfterCorrect : 0;
    setTimeout(function () {
      var wrapper = elements.questionCardWrapper;
      if (wrapper) wrapper.classList.add('slide-out');
      setTimeout(function () {
        gameState.currentRound += 1;
        if (gameState.currentRound >= gameState.totalRounds) {
          if (wrapper) wrapper.classList.remove('slide-out');
          endGame();
          return;
        }
        gameState.answered = false;
        gameState.selectedAnswerIndex = null;
        gameState.lives = gameState.maxLives;
        if (wrapper) {
          wrapper.classList.remove('slide-out');
          wrapper.classList.add('slide-in');
        }
        setRoundContent();
        if (wrapper) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              wrapper.classList.add('ready');
            });
          });
          setTimeout(function () {
            wrapper.classList.remove('slide-in', 'ready');
            elements.btnSubmitAnswer.disabled = true;
            gameState.timeLeft = gameState.roundTime;
            gameState.roundStartedAt = Date.now();
            startTimer();
            saveGameState();
          }, 420);
        } else {
          runRound();
        }
      }, 420);
    }, delay + 400);
  }

  // ========== END GAME ==========
  function endGame() {
    stopTimer();
    clearGameState();
    if (gameState.score > user.highScore) {
      user.highScore = gameState.score;
      lastGameWasNewBest = true;
    }
    if (gameState.correctCount === gameState.totalRounds) user.wins += 1;
    var newAchievements = checkAchievements();
    saveCurrentUserToRegistry();

    elements.endScore.textContent = gameState.score;
    elements.endCorrect.textContent = gameState.correctCount;
    elements.endRounds.textContent = gameState.totalRounds;

    var perfect = gameState.correctCount === gameState.totalRounds;
    elements.endIcon.textContent = perfect ? '🏆' : '🍌';
    elements.endTitle.textContent = perfect ? 'Perfect run!' : 'Game over!';
    elements.endMessage.textContent = perfect
      ? 'You got every question right. Amazing!'
      : 'You got ' + gameState.correctCount + ' of ' + gameState.totalRounds + ' correct.';

    showScreen('end');
  }

  function handlePlayAgain() {
    gameState.difficulty = gameState.difficulty || 'medium';
    startGame();
  }

  function handleBackHome() {
    clearGameState();
    updateProfileUI();
    updateHomeUI();
    showScreen('home');
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-screen') === 'home');
    });
    if (lastGameWasNewBest) {
      playNewBestAnimation();
      lastGameWasNewBest = false;
    }
  }

  function playNewBestAnimation() {
    var wrap = document.getElementById('home-best-wrap');
    if (!wrap) return;
    wrap.classList.add('new-best-celebrate');
    var badge = document.getElementById('new-best-badge');
    if (badge) {
      badge.setAttribute('aria-hidden', 'false');
    }
    setTimeout(function () {
      wrap.classList.remove('new-best-celebrate');
      if (badge) {
        badge.setAttribute('aria-hidden', 'true');
      }
    }, 2500);
  }

  // ========== INIT ==========
  function loadStoredUser() {
    return apiMe()
      .then(function (me) {
        if (!me) return;
        applyUserPayload(me);
        try {
          localStorage.setItem(STORAGE_KEY_USER, JSON.stringify({
            username: user.username,
            email: user.email,
            highScore: user.highScore,
            totalGames: user.totalGames,
            wins: user.wins,
            achievements: user.achievements || []
          }));
        } catch (e) {}
        updateProfileUI();
        updateHomeUI();
        renderLeaderboard();
      })
      .catch(function (err) {
        console.warn('Session restore:', err.message || err);
        user = { username: '', email: '', totalGames: 0, highScore: 0, wins: 0, achievements: [] };
        try { localStorage.removeItem(STORAGE_KEY_USER); } catch (e) {}
      });
  }

  function init() {
    showAuthForm('login');
    loadStoredUser().then(function () {
      if (user && user.username && tryRestoreGame()) {
        showScreen('play');
        restoreRound();
      }
    });

    var btnSplashEnter = document.getElementById('btn-splash-enter');
    if (btnSplashEnter) {
      btnSplashEnter.addEventListener('click', function () {
        if (user && user.username) {
          showScreen('home');
        } else {
          showScreen('login');
        }
      });
    }

    document.getElementById('btn-show-signup').addEventListener('click', function () {
      showAuthForm('signup');
      if (elements.signupError) elements.signupError.textContent = '';
    });
    document.getElementById('btn-show-login').addEventListener('click', function () {
      showAuthForm('login');
      if (elements.loginError) elements.loginError.textContent = '';
    });
    elements.formLogin.addEventListener('submit', handleLoginSubmit);
    elements.formSignup.addEventListener('submit', handleSignupSubmit);

    elements.difficultyCards.forEach(function (card) {
      card.addEventListener('click', function () {
        selectDifficulty(card.getAttribute('data-difficulty'));
      });
    });
    elements.btnStartGame.addEventListener('click', startGame);

    elements.btnSubmitAnswer.addEventListener('click', handleSubmitAnswer);
    elements.btnPlayAgain.addEventListener('click', handlePlayAgain);
    elements.btnBackHome.addEventListener('click', handleBackHome);

    bindNavButtons();

    var btnEditProfile = document.getElementById('btn-edit-profile');
    if (btnEditProfile) {
      btnEditProfile.addEventListener('click', showEditUsernameModal);
    }
    if (elements.formEditUsername) {
      elements.formEditUsername.addEventListener('submit', handleEditUsernameSubmit);
    }
    if (elements.btnEditUsernameCancel) {
      elements.btnEditUsernameCancel.addEventListener('click', hideEditUsernameModal);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
