// ==========================================
// 1. КОНФИГУРАЦИЯ И СОСТОЯНИЕ
// ==========================================

const SUPABASE_URL = "https://ngggevtocwmxusfijiek.supabase.co";
const SUPABASE_KEY = "sb_publishable_m4nQGC2PNLChZ95KxOd-RA_ALLYNECD";

// Глобальное состояние
const state = {
    levels: [],
    victors: [],
    isHistoryMode: false,
    currentSnapshotDate: null,
    currentLevelIdForModal: null,
    selectedPlayers: new Set(),
    globalDemonlist: [],
    globalDemonlistLoaded: false,
    ratingType: 't50'
};

const BASE_API_URL = 'https://api.demonlist.org';

// ==========================================
// 2. АВТОРИЗАЦИЯ АДМИНИСТРАТОРА
// ==========================================

let isAdmin = false;
let adminToken = null; // Хранится только в памяти, не в localStorage

// Формируем заголовки: для записи используем токен, для чтения — анонимный ключ
function getHeaders(forWrite = false) {
    const base = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    };
    if (forWrite && adminToken) {
        base["Authorization"] = "Bearer " + adminToken;
    } else {
        base["Authorization"] = "Bearer " + SUPABASE_KEY;
    }
    return base;
}

// Логин через Supabase Auth REST
async function loginAdmin() {
    const email = prompt("Email администратора:");
    if (!email) return;
    const password = prompt("Пароль:");
    if (!password) return;

    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                "apikey": SUPABASE_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            alert("Ошибка входа: " + (data.error_description || data.msg || "Неверные данные"));
            return;
        }

        adminToken = data.access_token; // Только в памяти, при перезагрузке нужно войти снова
        isAdmin = true;
        setAdminMode(true);
        updateLoginButton();
        alert("✅ Вы вошли как администратор");

    } catch (e) {
        alert("Ошибка соединения: " + e.message);
    }
}

// Выход
async function logoutAdmin() {
    try {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": "Bearer " + adminToken
            }
        });
    } catch (e) {
        // Игнорируем ошибки при выходе
    }

    adminToken = null; // Просто обнуляем переменную в памяти
    isAdmin = false;
    setAdminMode(false);
    updateLoginButton();
}

// Проверка сессии не нужна — токен хранится только в памяти
// После перезагрузки страницы нужно войти заново
async function checkSavedSession() {
    // Намеренно пусто — это безопаснее, чем хранить токен в localStorage
}

// Показываем/скрываем статичные кнопки администратора
function setAdminMode(on) {
    const addBtn = document.getElementById('addBtn');
    if (addBtn) addBtn.style.display = on ? '' : 'none';

    // ДОБАВИТЬ ЭТУ СТРОКУ:
    const syncGdlBtn = document.getElementById('syncGdlBtn');
    if (syncGdlBtn) syncGdlBtn.style.display = (on && !state.isHistoryMode) ? '' : 'none';

    const ratingControls = document.querySelector('.rating-controls');
    if (ratingControls) ratingControls.style.display = on ? 'flex' : 'none';

    document.querySelectorAll('[onclick="createTimelineSnapshot()"]').forEach(el => {
        el.style.display = on ? '' : 'none';
    });

    renderLevels();
    renderPlayerRatings();
}

// Обновляем кнопку входа/выхода
function updateLoginButton() {
    const btn = document.getElementById('adminLoginBtn');
    if (!btn) return;
    btn.textContent = isAdmin ? '🚪 Выйти' : '🔐';
    btn.title = isAdmin ? 'Выйти из аккаунта администратора' : 'Войти как администратор';
}

// Создаем кнопку входа (фиксированная в углу)
function createLoginButton() {
    const btn = document.createElement('button');
    btn.id = 'adminLoginBtn';
    btn.textContent = '🔐';
    btn.title = 'Войти как администратор';
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        background: #333;
        color: white;
        border: 1px solid #555;
        padding: 10px 14px;
        border-radius: 50px;
        cursor: pointer;
        font-size: 1.1em;
        opacity: 0.7;
        transition: opacity 0.2s;
    `;
    btn.onmouseenter = () => btn.style.opacity = '1';
    btn.onmouseleave = () => btn.style.opacity = '0.7';
    btn.onclick = () => isAdmin ? logoutAdmin() : loginAdmin();
    document.body.appendChild(btn);
}

// ==========================================
// 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (API)
// ==========================================

async function sbFetch(endpoint, options = {}) {
    const method = options.method || 'GET';
    const isWrite = ['POST', 'PATCH', 'DELETE'].includes(method.toUpperCase());
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: { ...getHeaders(isWrite), ...options.headers }
    });
    if (!response.ok) {
        const err = await response.json();
        console.error("Supabase Error:", err);
        // Если ошибка авторизации — значит токен устарел
        if (response.status === 401 || response.status === 403) {
            if (isAdmin) {
                alert("Сессия администратора истекла. Войдите снова.");
                await logoutAdmin();
            }
        }
        throw new Error(err.message || "Ошибка запроса к БД");
    }
    return response.json();
}

// --- Загрузка глобального рейтинга ---
// Замените функцию fetchGlobalDemonlist в script.js

async function fetchGlobalDemonlist() {
    const allLevels = [];
    let offset = 0;
    const limit = 500;

    try {
        console.log("Начинаем загрузку глобального рейтинга...");

        while (true) {
            const url = `https://gdl-vercel.vercel.app/api/proxy?limit=${limit}&offset=${offset}`;
            console.log(`Загружаем страницу через Vercel-прокси: offset=${offset}`);

            let result;
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`Ошибка загрузки offset=${offset}: ${response.status}`);
                    break;
                }
                const text = await response.text();
                if (!text || text.trim() === '') {
                    console.log(`Пустой ответ на offset=${offset}, завершаем`);
                    break;
                }
                result = JSON.parse(text);
            } catch (e) {
                console.warn(`Ошибка парсинга на offset=${offset}:`, e.message);
                break; // Прерываем цикл, но НЕ теряем уже загруженные уровни
            }

            if (result.message === 'success') {
                const levels = result.data?.levels || result.data || [];

                if (levels.length > 0) {
                    console.log(`Получено ${levels.length} уровней`);
                    allLevels.push(...levels);

                    if (levels.length < limit) {
                        break; // Последняя страница
                    }
                    offset += limit;
                } else {
                    break;
                }
            } else {
                console.error("API вернул ошибку:", result.message);
                break;
            }
        }

        console.log(`Загружено ${allLevels.length} уровней из глобального рейтинга`);
        return allLevels; // Возвращаем что успели загрузить

    } catch (error) {
        console.error('Критическая ошибка при загрузке GDL:', error);
        return allLevels; // Возвращаем что успели, а не []
    }
}

// --- Поиск позиции в глобальном рейтинге ---
function findGlobalPosition(levelName, creatorName) {
    if (!state.globalDemonlist || !Array.isArray(state.globalDemonlist) || state.globalDemonlist.length === 0) {
        return null;
    }

    const searchName = levelName.toLowerCase().trim();
    const searchCreator = creatorName ? creatorName.toLowerCase().trim() : null;

    // Точное совпадение имени и автора
    let match = state.globalDemonlist.find(level => 
        level.name?.toLowerCase().trim() === searchName &&
        level.creator?.toLowerCase().trim() === searchCreator
    );
    if (match) return match.placement || null;

    // Только по имени
    match = state.globalDemonlist.find(level => 
        level.name?.toLowerCase().trim() === searchName
    );
    if (match) return match.placement || null;

    // Удаляем возможные метки в скобках [something] или (something)
    const cleanName = searchName.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
    if (cleanName !== searchName) {
        match = state.globalDemonlist.find(level => 
            level.name?.toLowerCase().trim() === cleanName
        );
        if (match) return match.placement || null;
    }

    return null;
}

function findGlobalLevelPoints(levelName, creatorName) {
    if (!state.globalDemonlist || !Array.isArray(state.globalDemonlist) || state.globalDemonlist.length === 0) {
        return 0;
    }

    const searchName = levelName.toLowerCase().trim();
    const searchCreator = creatorName ? creatorName.toLowerCase().trim() : null;

    // Точное совпадение имени и автора
    let match = state.globalDemonlist.find(level => 
        level.name?.toLowerCase().trim() === searchName &&
        (searchCreator ? level.creator?.toLowerCase().trim() === searchCreator : true)
    );
    if (match) return parseFloat(match.points) || 0;

    // Только по имени
    match = state.globalDemonlist.find(level => 
        level.name?.toLowerCase().trim() === searchName
    );
    if (match) return parseFloat(match.points) || 0;

    // Удаляем возможные метки в скобках
    const cleanName = searchName.replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim();
    if (cleanName !== searchName) {
        match = state.globalDemonlist.find(level => 
            level.name?.toLowerCase().trim() === cleanName
        );
        if (match) return parseFloat(match.points) || 0;
    }

    return 0;
}

// ==========================================
// 4. ЛОГИКА ПОДСЧЕТА ОЧКОВ
// ==========================================

// function calculatePoints(rank) {
//     if (rank === 1) return 1000;
//     if (rank >= 2 && rank <= 10) return 1000 - (rank - 1) * 40;
//     if (rank >= 11 && rank <= 25) return 640 - (rank - 10) * 20;
//     if (rank >= 26 && rank <= 50) return 340 - (rank - 25) * 8;
//     return 0;
// }

function calculatePoints(rank) {
    if (!rank || rank <= 0) return 0;
    if (rank > 150) return 15; // Фиксированный бонус за экстримы вне топа

    // Формула экспоненциального затухания.
    // 0.028 - это коэффициент падения. Чем он больше, тем быстрее падают баллы.
    const points = 1000 * Math.exp(-0.028 * (rank - 1));

    return Math.round(points);
}

function getRankColorClass(rank) {
    if (rank === 1) return 'gold';
    if (rank === 2) return 'silver';
    if (rank === 3) return 'bronze';
    return '';
}

function calculatePlayerRatings() {
    const playerStats = {};
    const levelRankMap = {};

    state.levels.forEach(lvl => {
        levelRankMap[lvl.id] = lvl.position;
    });

    state.victors.forEach(victor => {
        const rank = levelRankMap[victor.level_id];
        if (rank === undefined) return;

        const points = calculatePoints(rank);
        const name = victor.player_name.trim();

        if (!playerStats[name]) {
            playerStats[name] = {
                name: name,
                points: 0,
                levelsBeat: 0
            };
        }
        playerStats[name].points += points;
        playerStats[name].levelsBeat += 1;
    });

    return Object.values(playerStats).sort((a, b) => b.points - a.points);
}

function calculatePlayerRatingsGDL() {
    const playerStats = {};

    state.victors.forEach(victor => {
        const level = state.levels.find(l => l.id === victor.level_id);
        if (!level) return; // уровень удалён

        let points = findGlobalLevelPoints(level.name, level.creator);
        points = parseFloat(points) || 0; // дополнительная страховка
        if (points === 0) return; // уровень не найден в GDL или очки = 0

        const name = victor.player_name.trim();

        if (!playerStats[name]) {
            playerStats[name] = { name, points: 0, levelsBeat: 0 };
        }
        playerStats[name].points += points; // теперь точно число
        playerStats[name].levelsBeat += 1;
    });

    return Object.values(playerStats).sort((a, b) => b.points - a.points);
}

// ==========================================
// 5. ИНИЦИАЛИЗАЦИЯ И ЗАГРУЗКА
// ==========================================

async function init() {
    try {
        await Promise.all([loadLevels(), loadVictors()]);

        renderPlayerCheckboxes();
        renderLevels();
        renderPlayerRatings();

        console.log("Начинаем загрузку глобального рейтинга...");
        const globalList = await fetchGlobalDemonlist();

        if (globalList && globalList.length > 0) {
            console.log(`Глобальный рейтинг загружен: ${globalList.length} уровней`);
            state.globalDemonlist = globalList;
        } else {
            console.warn("Глобальный рейтинг не загружен или пуст");
            state.globalDemonlist = [];
        }

        state.globalDemonlistLoaded = true;
        renderPlayerRatings();

        renderLevels();
        setupEventListeners();
        updateRatingButtonsActive();
        
        console.log("Приложение полностью загружено");
    } catch (e) {
        console.error("Ошибка инициализации:", e);
        alert("Ошибка инициализации: " + e.message);

        renderPlayerCheckboxes();
        renderLevels();
        renderPlayerRatings();
    }
}

async function loadLevels() {
    const data = await sbFetch('levels?select=*&order=position.asc');
    state.levels = data;
    return data;
}

async function loadVictors() {
    const data = await sbFetch('victors?select=*');
    state.victors = data;
    return data;
}

// ==========================================
// 6. РЕНДЕРИНГ (ОТОБРАЖЕНИЕ)
// ==========================================

// --- ГЕНЕРАЦИЯ ЧЕКБОКСОВ ---
function renderPlayerCheckboxes() {
    const container = document.getElementById('playersCheckboxes');
    if (!container) return;

    container.innerHTML = '';
    const uniquePlayers = [...new Set(state.victors.map(v => v.player_name.trim()))].sort();

    if (uniquePlayers.length === 0) {
        container.innerHTML = '<span style="color:#777;">Нет игроков</span>';
        return;
    }

    uniquePlayers.forEach(player => {
        const label = document.createElement('label');
        label.className = 'player-checkbox-item';
        label.style.display = 'inline-flex';
        label.style.alignItems = 'center';
        label.style.margin = '5px 10px 5px 0';
        label.style.cursor = 'pointer';
        label.style.padding = '5px 10px';
        label.style.borderRadius = '4px';
        label.style.transition = 'background 0.2s';

        const isSelected = state.selectedPlayers.has(player);
        label.style.background = isSelected ? '#4caf50' : '#2a2a35';
        label.style.color = 'white';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = player;
        checkbox.checked = isSelected;
        checkbox.style.marginRight = '8px';

        checkbox.onchange = (e) => {
            if (e.target.checked) {
                state.selectedPlayers.add(player);
            } else {
                state.selectedPlayers.delete(player);
            }

            renderPlayerCheckboxes();
            renderLevels();
            renderPlayerRatings();

            const ratingSection = document.querySelector('.player-rating-section');
            if (ratingSection) {
                ratingSection.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
        };

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(player));
        container.appendChild(label);
    });
}

// --- СПИСОК УРОВНЕЙ ---
function renderLevels() {
    const list = document.getElementById('levelList');

    if (!list) {
        console.error('Элемент levelList не найден');
        return;
    }

    if (!state.globalDemonlistLoaded && state.levels.length > 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Загрузка данных с Global Demonlist...</div>';
    }

    let levelsToRender = state.levels;
    if (state.selectedPlayers.size > 0) {
        levelsToRender = state.levels.filter(level => {
            return state.victors.some(v =>
                v.level_id === level.id && state.selectedPlayers.has(v.player_name.trim())
            );
        });
    }

    if (!levelsToRender || levelsToRender.length === 0) {
        if (state.selectedPlayers.size > 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Выбранные игроки не прошли ни одного уровня из списка.</div>';
        } else {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Список уровней пуст.</div>';
        }
        return;
    }

    list.innerHTML = '';

    levelsToRender.forEach(level => {
        try {
            const li = document.createElement('li');
            li.id = `level-${level.id}`;

            const victorCount = state.victors.filter(v => v.level_id === level.id).length;
            const points = calculatePoints(level.position);

            let globalPosText = '';
            if (!state.globalDemonlistLoaded) {
                globalPosText = `<span style="font-size:0.75em; color:#777; margin-left:6px;">⏳ GDL...</span>`;
            } else {
                try {
                    const globalPos = findGlobalPosition(level.name, level.creator);
                    if (globalPos) {
                        globalPosText = `<a href="https://demonlist.org/classic/${globalPos}" target="_blank" rel="noopener noreferrer" title="Открыть на Global Demonlist" style="font-size:0.78em; color:#ff9800; margin-left:8px; text-decoration:none; background:rgba(255,152,0,0.12); padding:1px 7px; border-radius:10px; border:1px solid rgba(255,152,0,0.35); white-space:nowrap;">🌍 GDL #${globalPos}</a>`;
                    } else {
                        globalPosText = `<span style="font-size:0.75em; color:#555; margin-left:6px;" title="Не найден на Global Demonlist">GDL: —</span>`;
                    }
                } catch (error) {
                    console.error(`Ошибка при поиске глобальной позиции для уровня ${level.name}:`, error);
                    globalPosText = `<span style="font-size:0.75em; color:#555; margin-left:6px;">GDL: —</span>`;
                }
            }

            // Кнопки: если режим истории — только просмотр победителей
            // Если обычный режим: кнопка победителей видна всем, кнопка удаления — только админу
            let actionsHtml = '';
            if (state.isHistoryMode) {
                actionsHtml = `
                    <div class="actions">
                        <button class="victors-btn" onclick="openVictorsModal(${level.id}, '${escapeHtml(level.name)}')">
                            📜 ${victorCount}
                        </button>
                    </div>`;
            } else {
                const deleteBtn = isAdmin
                    ? `<button class="delete" onclick="deleteLevel(${level.id})">🗑️</button>`
                    : '';
                actionsHtml = `
                    <div class="actions">
                        <button class="victors-btn" onclick="openVictorsModal(${level.id}, '${escapeHtml(level.name)}')">
                            🏆 ${victorCount}
                        </button>
                        ${deleteBtn}
                    </div>`;
            }

            let filterInfo = '';
            if (state.selectedPlayers.size > 0) {
                try {
                    const filteredVictors = state.victors
                        .filter(v => v.level_id === level.id && state.selectedPlayers.has(v.player_name.trim()));

                    const sortedVictors = [...filteredVictors].sort((a, b) => {
                        const dateA = new Date(a.victory_date || a.created_at || 0);
                        const dateB = new Date(b.victory_date || b.created_at || 0);
                        return dateA - dateB;
                    });

                    const whoBeatIt = sortedVictors.map(v => v.player_name).join(', ');

                    if (whoBeatIt) {
                        filterInfo = `<div style="font-size:0.75em; color:#ff9800; margin-top:3px;">✅ Прошли: ${escapeHtml(whoBeatIt)}</div>`;
                    }
                } catch (error) {
                    console.error('Ошибка при фильтрации победителей:', error);
                }
            }

            li.innerHTML = `
                <div>
                    <strong>#${level.position} ${escapeHtml(level.name)}</strong> 
                    by ${escapeHtml(level.creator)}
                    ${globalPosText}
                    <div style="font-size: 0.8em; color: #e5be37; margin-top: 4px;">
                        ⭐ ${points} баллов
                    </div>
                    ${filterInfo}
                </div>
                ${actionsHtml}
            `;

            list.appendChild(li);

        } catch (error) {
            console.error('Ошибка при рендеринге уровня:', error, level);
        }
    });

    if (list.children.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#e53935;">Ошибка при отображении уровней</div>';
    }
}

// --- РЕЙТИНГ ИГРОКОВ ---
function renderPlayerRatings() {
    const container = document.getElementById('playerRatingsList');
    container.innerHTML = '';

    let sortedPlayers;
    if (state.ratingType === 'gdl') {
        if (!state.globalDemonlistLoaded) {
            container.innerHTML = '<div class="empty-rating">Загрузка GDL...</div>';
            return;
        }
        sortedPlayers = calculatePlayerRatingsGDL();
    } else {
        sortedPlayers = calculatePlayerRatings(); // T50
    }

    if (sortedPlayers.length === 0) {
        container.innerHTML = '<div class="empty-rating">Нет данных</div>';
        return;
    }

    let displayedCount = 0;
    sortedPlayers.forEach((player, index) => {
        // Пропускаем игроков, которые не выбраны в фильтре
        if (state.selectedPlayers.size > 0 && !state.selectedPlayers.has(player.name)) {
            return; 
        }
        
        displayedCount++;
        const rank = index + 1;
        const colorClass = getRankColorClass(rank);

        const div = document.createElement('div');
        div.className = 'rank-item';
        
        // Добавляем клик для открытия профиля
        div.style.cursor = 'pointer';
        div.onclick = () => {
            if (typeof window.openPlayerProfile === 'function') {
                window.openPlayerProfile(player.name);
            } else {
                console.error("Функция openPlayerProfile не найдена!");
            }
        };

        if (state.selectedPlayers.has(player.name)) {
            div.style.border = '1px solid #4caf50';
            div.style.background = '#2a2a35';
        }

        // Форматируем баллы в зависимости от типа рейтинга
        let pointsFormatted;
        if (state.ratingType === 'gdl') {
            pointsFormatted = Number(player.points).toFixed(2); // Оставляем дробную часть
        } else {
            pointsFormatted = Math.round(Number(player.points)); // Округляем до целого для T50
        }

        div.innerHTML = `
            <div class="rank-info">
                <div class="rank-number">#${rank}</div>
                <div class="rank-name">${escapeHtml(player.name)}</div>
                <div class="rank-stats">
                    <span class="rank-points ${colorClass}">${pointsFormatted} баллов</span>
                    <span class="rank-levels">😈 Демонов: ${player.levelsBeat}</span>
                </div>
            </div>
        `;
        container.appendChild(div);
    });

    if (displayedCount === 0 && state.selectedPlayers.size > 0) {
        container.innerHTML = '<div style="padding:15px; text-align:center;">Выбранные игроки не найдены в рейтинге.</div>';
    }
}

function updateRatingButtonsActive() {
    const t50Btn = document.getElementById('ratingT50Btn');
    const gdlBtn = document.getElementById('ratingGDLBtn');
    if (state.ratingType === 't50') {
        t50Btn.classList.add('active');
        gdlBtn.classList.remove('active');
    } else {
        gdlBtn.classList.add('active');
        t50Btn.classList.remove('active');
    }
}

// ==========================================
// 7. УПРАВЛЕНИЕ (CRUD) - С ПОДДЕРЖКОЙ ИСТОРИИ
// ==========================================

document.getElementById('addBtn').onclick = async () => {
    if (!isAdmin && !state.isHistoryMode) return alert("Требуется вход администратора");
    
    const name = prompt("Название уровня:");
    if (!name) return;
    const creator = prompt("Создатель (Creator):");

    document.body.style.cursor = 'wait';
    try {
        if (state.isHistoryMode) {
            // === РЕЖИМ ИСТОРИИ (Ручной ввод позиции остается) ===
            const defaultPos = state.levels.length < 50 ? state.levels.length + 1 : 50;
            const positionStr = prompt("Позиция в топе (1-50):", defaultPos);
            const newPosition = parseInt(positionStr);
            if (isNaN(newPosition) || newPosition < 1) {
                document.body.style.cursor = 'default';
                return alert("Позиция должна быть числом от 1");
            }

            const levelsToShift = state.levels
                .filter(l => l.position >= newPosition)
                .sort((a, b) => b.position - a.position);
            
            for (const level of levelsToShift) {
                const nextPos = level.position + 1;
                if (nextPos > 50) {
                    state.levels = state.levels.filter(l => l.id !== level.id);
                    state.victors = state.victors.filter(v => v.level_id !== level.id);
                } else {
                    level.position = nextPos;
                }
            }

            const newLevelObj = {
                name: name,
                creator: creator,
                position: newPosition,
                id: Date.now() // Временный ID
            };
            
            state.levels.push(newLevelObj);
            state.levels.sort((a, b) => a.position - b.position);

            renderLevels();
            renderPlayerRatings();
            alert("Уровень добавлен в текущий снимок (не забудьте нажать 'Сохранить изменения')");

        } else {
            // === LIVE РЕЖИМ (Автоматическая позиция по GDL) ===
            if (!state.globalDemonlistLoaded) {
                document.body.style.cursor = 'default';
                return alert("Дождитесь загрузки Global Demonlist (GDL) перед добавлением уровня.");
            }

            // 1. Создаем уровень с временной позицией
            const newLevelObj = {
                name: name,
                creator: creator,
                position: 999 
            };
            
            const res = await sbFetch('levels', { method: 'POST', body: JSON.stringify(newLevelObj) });
            newLevelObj.id = res[0].id;
            state.levels.push(newLevelObj);

            // 2. Вызываем функцию авто-сортировки всего списка по GDL
            await autoSortLiveLevels();
            alert("Уровень добавлен! Позиции всех уровней автоматически пересчитаны по GDL.");
        }
    } catch (e) {
        console.error(e);
        alert("Ошибка: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
};

// Автоматическая пересортировка Live-списка на основе позиций GDL
async function autoSortLiveLevels() {
    // 1. Присваиваем каждому уровню его GDL позицию
    const levelsWithGdl = state.levels.map(lvl => {
        const gdlPos = findGlobalPosition(lvl.name, lvl.creator);
        return {
            ...lvl,
            gdlPosition: gdlPos ? parseInt(gdlPos) : Infinity // Если нет в GDL, кидаем в самый низ
        };
    });

    // 2. Сортируем: чем меньше номер в GDL, тем выше уровень у нас
    levelsWithGdl.sort((a, b) => a.gdlPosition - b.gdlPosition);

    const updatedLevels = [];
    let currentPos = 1;
    
    // 3. Перезаписываем позиции от 1 и далее
    for (const lvl of levelsWithGdl) {
        // Ограничение: оставляем только топ-50, остальных удаляем
        if (currentPos > 50) {
            console.log(`Уровень ${lvl.name} вылетает из топ-50 и будет удален.`);
            await sbFetch(`victors?level_id=eq.${lvl.id}`, { method: 'DELETE' });
            await sbFetch(`levels?id=eq.${lvl.id}`, { method: 'DELETE' });
            state.victors = state.victors.filter(v => v.level_id !== lvl.id);
            continue; 
        }

        // Если локальная позиция изменилась, обновляем в БД
        if (lvl.position !== currentPos) {
            lvl.position = currentPos;
            await sbFetch(`levels?id=eq.${lvl.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ position: currentPos })
            });
        }
        
        // Убираем временное поле перед сохранением в стейт
        const { gdlPosition, ...cleanLevel } = lvl;
        updatedLevels.push(cleanLevel);
        currentPos++;
    }

    // 4. Обновляем UI
    state.levels = updatedLevels;
    renderLevels();
    renderPlayerRatings();
    renderPlayerCheckboxes();
}

async function deleteLevel(id) {
    if (!isAdmin) return alert("Требуется вход администратора");
    if (!confirm("Удалить уровень? Это сдвинет нижние уровни вверх.")) return;

    const levelToDelete = state.levels.find(l => String(l.id) === String(id));

    if (!levelToDelete) {
        alert("Ошибка: уровень не найден в памяти.");
        return;
    }

    const deletedPos = levelToDelete.position;
    document.body.style.cursor = 'wait';

    try {
        if (!state.isHistoryMode) {
            await sbFetch(`victors?level_id=eq.${id}`, { method: 'DELETE' });
            await sbFetch(`levels?id=eq.${id}`, { method: 'DELETE' });

            const levelsToShift = state.levels.filter(l => l.position > deletedPos);

            for (const lvl of levelsToShift) {
                await sbFetch(`levels?id=eq.${lvl.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ position: lvl.position - 1 })
                });
            }
        }

        state.levels = state.levels.filter(l => String(l.id) !== String(id));
        state.victors = state.victors.filter(v => String(v.level_id) !== String(id));

        state.levels.forEach(l => {
            if (l.position > deletedPos) {
                l.position -= 1;
            }
        });

        state.levels.sort((a, b) => a.position - b.position);

        renderLevels();
        renderPlayerRatings();
        renderPlayerCheckboxes();

        if (state.isHistoryMode) {
            alert(`Уровень удален. Уровни с ${deletedPos + 1}-го места сдвинуты вверх.`);
        }

    } catch (e) {
        console.error(e);
        alert("Ошибка при удалении: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
}

window.syncWithGDL = async () => {
    if (!isAdmin) return alert("Требуется вход администратора");
    if (state.isHistoryMode) return alert("Синхронизация недоступна в режиме истории");
    if (!state.globalDemonlistLoaded) return alert("Дождитесь загрузки Global Demonlist (GDL)");

    const msg = "Вы уверены, что хотите пересортировать топ по текущим позициям GDL?\n\nЭто автоматически изменит позиции уровней от 1 до 50. Уровни, вылетевшие за пределы топ-50, будут удалены из базы вместе с победителями.";
    if (!confirm(msg)) return;

    document.body.style.cursor = 'wait';
    try {
        // Используем функцию авто-сортировки, которую мы добавили на предыдущем шаге
        await autoSortLiveLevels(); 
        alert("✅ Успех! Позиции уровней синхронизированы с GDL.");
    } catch (e) {
        console.error(e);
        alert("Ошибка синхронизации: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
};

// ==========================================
// 8. МОДАЛЬНЫЕ ОКНА
// ==========================================

window.openPlayerProfile = (playerName) => {
    document.getElementById('profilePlayerName').innerText = playerName;
    
    // Получаем все прохождения этого игрока
    const playerVictories = state.victors.filter(v => v.player_name.trim() === playerName);
    
    const listContainer = document.getElementById('profileDemonsList');
    const hardestContainer = document.getElementById('profileHardestDemon');
    const countContainer = document.getElementById('profileDemonsCount');
    
    listContainer.innerHTML = '';
    countContainer.innerText = playerVictories.length;
    
    if (playerVictories.length === 0) {
        listContainer.innerHTML = '<div class="empty-victors">Нет пройденных уровней</div>';
        hardestContainer.innerHTML = '<span style="color:#aaa;">Нет данных</span>';
        document.getElementById('playerProfileModal').style.display = 'flex';
        return;
    }

    // Собираем инфу об уровнях и считаем очки в зависимости от текущего режима (T50 или GDL)
    const beatenLevels = playerVictories.map(v => {
        const level = state.levels.find(l => l.id === v.level_id);
        if (!level) return null;
        
        let points = 0;
        let positionText = '';
        
        if (state.ratingType === 'gdl') {
            points = findGlobalLevelPoints(level.name, level.creator) || 0;
            const gdlPos = findGlobalPosition(level.name, level.creator);
            positionText = gdlPos ? `(GDL #${gdlPos})` : '(GDL: —)';
        } else {
            points = calculatePoints(level.position);
            positionText = `(TOP #${level.position})`;
        }

        return {
            ...level,
            points: points,
            positionText: positionText,
            victory_date: v.victory_date,
            proof_link: v.proof_link
        };
    }).filter(l => l !== null);

    // Сортируем уровни по очкам (по убыванию), чтобы сложнейший был первым
    beatenLevels.sort((a, b) => b.points - a.points);
    
    // --- Выводим сложнейший демон ---
    const hardest = beatenLevels[0];
    if (hardest) {
        hardestContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
                <div>
                    <strong style="color: #4fc3f7; font-size: 1.2em;">${escapeHtml(hardest.name)}</strong> 
                    <span style="color: #aaa; font-size: 0.9em; margin-left: 5px;">${hardest.positionText}</span>
                </div>
                <div style="color: #f26c39; font-weight: bold; margin-top: 5px;">
                    🔥 ${Number(hardest.points)} баллов
                </div>
            </div>
        `;
    }

    // --- Выводим список всех пройденных демонов ---
    // Меняем класс контейнера, чтобы уровни выстроились в ряд с переносом
    listContainer.className = 'demon-badges-container';

    // --- Выводим список всех пройденных демонов прямоугольниками ---
    beatenLevels.forEach(level => {
        // Проверяем, есть ли ссылка на пруф
        const hasVideo = level.proof_link && level.proof_link.trim() !== '';
        
        // Создаем ссылку, если есть видео, или обычный текстовый блок, если нет
        const badge = document.createElement(hasVideo ? 'a' : 'span');
        
        badge.className = 'demon-badge';
        badge.textContent = level.name;
        
        if (hasVideo) {
            badge.href = level.proof_link;
            badge.target = '_blank'; // Открывать в новой вкладке
            badge.title = 'Смотреть видео прохождения';
        } else {
            badge.classList.add('no-video');
            badge.title = 'Нет видео';
        }
        
        listContainer.appendChild(badge);
    });

    document.getElementById('playerProfileModal').style.display = 'flex';
};

window.closePlayerProfileModal = () => {
    document.getElementById('playerProfileModal').style.display = 'none';
};

window.openVictorsModal = (levelId, levelName) => {
    state.currentLevelIdForModal = levelId;
    document.getElementById('victorsModal').style.display = 'flex';
    document.getElementById('currentLevelName').innerText = levelName;
    renderVictorsInModal();

    // Форму добавления показываем только администратору
    const form = document.querySelector('.add-victor-form');
    if (form) form.style.display = isAdmin ? 'block' : 'none';
};

window.closeVictorsModal = () => {
    document.getElementById('victorsModal').style.display = 'none';
    state.currentLevelIdForModal = null;
};

function renderVictorsInModal() {
    const list = document.getElementById('victorsList');
    list.innerHTML = '';

    let levelVictors = state.victors.filter(v => v.level_id === state.currentLevelIdForModal);

    levelVictors.sort((a, b) => {
        const dateA = new Date(a.victory_date || a.created_at || 0);
        const dateB = new Date(b.victory_date || b.created_at || 0);
        return dateA - dateB;
    });

    if (levelVictors.length === 0) {
        list.innerHTML = '<div class="empty-victors">Нет победителей</div>';
        return;
    }

    levelVictors.forEach((v, index) => {
        const div = document.createElement('div');
        div.className = 'victor-item';

        const rank = index + 1;

        let nameHtml = '';
        if (v.proof_link) {
            nameHtml = `
                <a href="${escapeHtml(v.proof_link)}" target="_blank" 
                   style="color: #fff; text-decoration: none; border-bottom: 1px dashed #aaa; transition: color 0.2s;"
                   onmouseover="this.style.color='#4caf50'; this.style.borderColor='#4caf50'"
                   onmouseout="this.style.color='#fff'; this.style.borderColor='#aaa'">
                   #${rank} ${escapeHtml(v.player_name)} 🔗
                </a>`;
        } else {
            nameHtml = `<span style="color: #fff;">#${rank} ${escapeHtml(v.player_name)}</span>`;
        }

        // Кнопку удаления показываем только администратору (и только не в режиме истории)
        const deleteBtn = (isAdmin && !state.isHistoryMode)
            ? `<button onclick="deleteVictor('${v.id}')" style="background:#e53935; padding:5px 10px; margin-left:10px;">🗑️</button>`
            : '';

        div.innerHTML = `
            <div class="victor-info">
                <div class="victor-name">${nameHtml}</div>
            </div>
            ${deleteBtn}
        `;
        list.appendChild(div);
    });
}

window.addVictor = async () => {
    if (!isAdmin) return alert("Требуется вход администратора");

    const nameInput = document.getElementById('playerNameInput');
    const proofInput = document.getElementById('proofLinkInput');
    const name = nameInput.value.trim();
    if (!name) return alert("Введите имя");

    document.body.style.cursor = 'wait';

    try {
        const newVictor = {
            level_id: state.currentLevelIdForModal,
            player_name: name,
            proof_link: proofInput.value.trim() || null,
            victory_date: new Date().toISOString(),
            id: state.isHistoryMode ? 'temp_' + Date.now() : undefined
        };

        if (!state.isHistoryMode) {
            await sbFetch('victors', { method: 'POST', body: JSON.stringify(newVictor) });
            await loadVictors();
        } else {
            state.victors.push(newVictor);
        }

        nameInput.value = '';
        proofInput.value = '';

        renderVictorsInModal();
        renderLevels();
        renderPlayerRatings();
        renderPlayerCheckboxes();

    } catch (e) {
        console.error(e);
        alert("Ошибка добавления: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
};

window.deleteVictor = async (victorId) => {
    if (!isAdmin) return alert("Требуется вход администратора");
    if (!confirm("Удалить это прохождение?")) return;
    try {
        if (!state.isHistoryMode) {
            await sbFetch(`victors?id=eq.${victorId}`, { method: 'DELETE' });
        }

        state.victors = state.victors.filter(v => String(v.id) !== String(victorId));

        renderVictorsInModal();
        renderLevels();
        renderPlayerRatings();
        renderPlayerCheckboxes();

    } catch (e) {
        console.error(e);
        alert("Ошибка при удалении: " + e.message);
    }
};

// ==========================================
// 9. МАШИНА ВРЕМЕНИ
// ==========================================

window.createTimelineSnapshot = async () => {
    if (!isAdmin) return alert("Требуется вход администратора");
    if (state.isHistoryMode) return alert("В режиме истории используйте зеленую кнопку 'Сохранить этот снимок' сверху");

    const today = new Date().toISOString().split('T')[0];
    const userDate = prompt(
        "За какую дату сохранить текущий (Live) топ?\nВведите дату в формате ГГГГ-ММ-ДД:",
        "2025-07-15"
    );

    if (!userDate) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(userDate)) {
        return alert("Неверный формат! Нужно ГГГГ-ММ-ДД (например, 2025-07-15)");
    }

    await saveSnapshotToDB(userDate);
};

async function saveSnapshotToDB(date) {
    if (!isAdmin) return alert("Требуется вход администратора");
    if (!confirm(`Сохранить состояние топ-листа за дату: ${date}?`)) return;

    const snapshotData = {
        snapshot_date: date,
        levels_data: state.levels,
        victors_summary: state.victors,
        levels_count: state.levels.length,
        victors_count: state.victors.length,
        created_at: new Date().toISOString()
    };

    try {
        await sbFetch(`daily_snapshots?snapshot_date=eq.${date}`, { method: 'DELETE' });
        await sbFetch('daily_snapshots', { method: 'POST', body: JSON.stringify(snapshotData) });

        alert(`Снимок за ${date} успешно сохранен!`);

        if (state.isHistoryMode) {
            await initCalendar();
        }
    } catch (e) {
        alert("Ошибка сохранения: " + e.message);
    }
}

window.loadDateSnapshot = async () => {
    const dateInput = document.getElementById('historyDate');
    const targetDate = dateInput.value;
    if (!targetDate) return;

    try {
        let data = await sbFetch(`daily_snapshots?snapshot_date=eq.${targetDate}&select=*`);

        if (data.length > 0) {
            enterHistoryMode(data[0], targetDate, false);
        } else {
            const prevData = await sbFetch(`daily_snapshots?snapshot_date=lt.${targetDate}&order=snapshot_date.desc&limit=1`);

            if (prevData.length > 0) {
                //alert(`Снимка за ${targetDate} нет. Загружены данные от ${prevData[0].snapshot_date}. Вы можете внести изменения и сохранить их как ${targetDate}.`);
                enterHistoryMode(prevData[0], targetDate, true);
            } else {
                alert(`Истории до ${targetDate} не найдено. Начинаем с чистого листа.`);
                const emptySnapshot = { levels_data: [], victors_summary: [] };
                enterHistoryMode(emptySnapshot, targetDate, true);
            }
        }
    } catch (e) {
        alert("Ошибка: " + e.message);
    }
};

function enterHistoryMode(snapshotData, dateStr, isNewBranch) {
    state.isHistoryMode = true;
    state.currentSnapshotDate = dateStr;

    state.levels = JSON.parse(JSON.stringify(snapshotData.levels_data || []));
    state.victors = JSON.parse(JSON.stringify(snapshotData.victors_summary || []));

    state.selectedPlayers.clear();

    const infoText = isNewBranch
        ? `📝 Редактирование: ${dateStr} (Основано на прошлом)`
        : `📜 Архив: ${dateStr}`;

    const infoContainer = document.getElementById('currentTimelineInfo');
    infoContainer.style.display = 'block';

    // Кнопки сохранения/переноса — только для администратора
    const adminButtons = isAdmin ? `
        <div style="display: flex; gap: 10px;">
            <button onclick="saveSnapshotToDB('${dateStr}')" style="background:#4caf50; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold;">
                💾 Сохранить
            </button>
            <button onclick="syncSnapshotToLive()" style="background:#e91e63; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold; color:white;" title="Сделать эти данные основными">
                🚀 Перенести в Live
            </button>
        </div>
    ` : '';

    infoContainer.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#2a2a35; padding:10px; border-radius:8px; border: 1px solid #ff9800; flex-wrap: wrap; gap: 10px;">
            <h3 style="margin:0; color:#ff9800;">${infoText}</h3>
            ${adminButtons}
        </div>
    `;

    document.getElementById('exitTimelineBtn').style.display = 'inline-block';
    document.getElementById('addBtn').style.display = isAdmin ? 'inline-block' : 'none';
    //document.getElementById('timelineFilters').style.display = 'none';
    document.getElementById('syncGdlBtn').style.display = 'none';

    renderPlayerCheckboxes();
    renderLevels();
    renderPlayerRatings();
    renderCalendar();
}

window.exitTimelineMode = async () => {
    state.isHistoryMode = false;
    state.currentSnapshotDate = null;
    state.selectedPlayers.clear();

    document.getElementById('currentTimelineInfo').style.display = 'none';
    document.getElementById('exitTimelineBtn').style.display = 'none';
    
    // ДОБАВИТЬ ЭТУ СТРОКУ:
    const syncGdlBtn = document.getElementById('syncGdlBtn');
    if (syncGdlBtn) syncGdlBtn.style.display = isAdmin ? 'inline-block' : 'none';

    await init();
};

window.toggleTimelineView = async () => {
    const filtersDiv = document.getElementById('timelineFilters');
    if (filtersDiv.style.display === 'none') {
        filtersDiv.style.display = 'block';
        await initCalendar();
    } else {
        filtersDiv.style.display = 'none';
    }
};

// ==========================================
// 10. СИНХРОНИЗАЦИЯ С LIVE-БАЗОЙ
// ==========================================

window.syncSnapshotToLive = async () => {
    if (!isAdmin) return alert("Требуется вход администратора");

    const confirmMsg = "ВНИМАНИЕ!\nЭто действие ПОЛНОСТЬЮ ПЕРЕЗАПИШЕТ текущий живой (Live) топ данными из этого снимка.\nСтарые Live-данные будут удалены.\n\nВы уверены, что хотите продолжить?";
    if (!confirm(confirmMsg)) return;

    document.body.style.cursor = 'wait';

    try {
        const liveLevels = await sbFetch('levels?select=id');
        for (const lvl of liveLevels) {
            await sbFetch(`victors?level_id=eq.${lvl.id}`, { method: 'DELETE' });
            await sbFetch(`levels?id=eq.${lvl.id}`, { method: 'DELETE' });
        }

        const liveVictors = await sbFetch('victors?select=id');
        for (const vic of liveVictors) {
            await sbFetch(`victors?id=eq.${vic.id}`, { method: 'DELETE' });
        }

        const idMap = {};

        for (const lvl of state.levels) {
            const newLevelObj = {
                name: lvl.name,
                creator: lvl.creator,
                position: lvl.position
            };

            const res = await sbFetch('levels', { method: 'POST', body: JSON.stringify(newLevelObj) });
            const newId = res[0].id;
            idMap[lvl.id] = newId;
        }

        for (const vic of state.victors) {
            const mappedLevelId = idMap[vic.level_id];

            if (mappedLevelId) {
                const newVictorObj = {
                    level_id: mappedLevelId,
                    player_name: vic.player_name,
                    proof_link: vic.proof_link || null,
                    victory_date: vic.victory_date || new Date().toISOString()
                };
                await sbFetch('victors', { method: 'POST', body: JSON.stringify(newVictorObj) });
            }
        }

        alert("Успех! Снимок успешно перенесен. Теперь это ваш основной топ.");

        await window.exitTimelineMode();

    } catch (e) {
        console.error(e);
        alert("Произошла ошибка при переносе: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
};

// ==========================================
// 11. ФИЛЬТРЫ ИГРОКОВ
// ==========================================

window.toggleAllPlayers = () => {
    const allNames = state.victors.map(v => v.player_name.trim());
    allNames.forEach(name => state.selectedPlayers.add(name));

    renderPlayerCheckboxes();
    renderLevels();
    renderPlayerRatings();

    const ratingSection = document.querySelector('.player-rating-section');
    if (ratingSection) {
        ratingSection.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
};

window.clearAllPlayers = () => {
    state.selectedPlayers.clear();

    renderPlayerCheckboxes();
    renderLevels();
    renderPlayerRatings();

    const ratingSection = document.querySelector('.player-rating-section');
    if (ratingSection) {
        ratingSection.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
};

// ==========================================
// 12. UI HELPERS
// ==========================================

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setupEventListeners() {
    window.onclick = function(event) {
        if (event.target.className === 'modal') {
            event.target.style.display = "none";
        }
    };

    // Обработчики кнопок переключения рейтинга
    document.getElementById('ratingT50Btn').addEventListener('click', () => {
        if (state.ratingType === 't50') return;
        state.ratingType = 't50';
        updateRatingButtonsActive();
        renderPlayerRatings();
    });

    document.getElementById('ratingGDLBtn').addEventListener('click', () => {
        if (state.ratingType === 'gdl') return;
        state.ratingType = 'gdl';
        updateRatingButtonsActive();
        renderPlayerRatings();
    });
}

window.recalculateAllRatingsSimple = () => {
    if (!isAdmin) return alert("Требуется вход администратора");
    renderPlayerRatings();
    alert("Рейтинг успешно пересчитан!");
};

window.showPointsInfo = () => {
    document.getElementById('pointsInfoModal').style.display = 'flex';
};

window.closePointsInfoModal = () => {
    document.getElementById('pointsInfoModal').style.display = 'none';
};

window.closeAllVictorsModal = () => {
    document.getElementById('allVictorsModal').style.display = 'none';
};

// ==========================================
// 13. ОКНО "ВСЕ ПОБЕДИТЕЛИ"
// ==========================================

document.getElementById('showAllVictorsBtn').onclick = () => {
    document.getElementById('allVictorsModal').style.display = 'flex';
    populateLevelFilter();
    renderAllVictorsList();
};

function populateLevelFilter() {
    const select = document.getElementById('levelFilter');
    select.innerHTML = '<option value="all">Все уровни</option>';

    const sortedLevels = [...state.levels].sort((a, b) => a.position - b.position);

    sortedLevels.forEach(lvl => {
        const option = document.createElement('option');
        option.value = lvl.id;
        option.textContent = `#${lvl.position} ${lvl.name}`;
        select.appendChild(option);
    });

    select.onchange = () => renderAllVictorsList();
}

function renderAllVictorsList() {
    const container = document.getElementById('allVictorsList');
    const filterValue = document.getElementById('levelFilter').value;
    container.innerHTML = '';

    let filteredVictors = state.victors;
    if (filterValue !== 'all') {
        filteredVictors = state.victors.filter(v => v.level_id == filterValue);
    }

    filteredVictors.sort((a, b) => {
        const dateA = new Date(a.victory_date || a.created_at || 0);
        const dateB = new Date(b.victory_date || b.created_at || 0);
        return dateB - dateA;
    });

    if (filteredVictors.length === 0) {
        container.innerHTML = '<div class="empty-victors">Записей не найдено</div>';
        return;
    }

    const levelNames = {};
    state.levels.forEach(l => levelNames[l.id] = l.name);

    filteredVictors.forEach(v => {
        const div = document.createElement('div');
        div.className = 'victor-item-with-level';

        const levelName = levelNames[v.level_id] || 'Удаленный уровень';
        const dateStr = v.victory_date ? new Date(v.victory_date).toLocaleDateString() : 'Неизвестно';

        // Кнопка удаления — только для администратора
        const deleteBtn = (isAdmin && !state.isHistoryMode)
            ? `<button onclick="deleteVictor('${v.id}')" style="float:right; background:#e53935; padding:4px 8px; font-size:0.8em;">🗑️</button>`
            : '';

        div.innerHTML = `
            <div class="victor-level">🏆 ${escapeHtml(levelName)}</div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; color:white;">${escapeHtml(v.player_name)}</span>
                <span style="font-size:0.85em; color:#aaa;">${dateStr}</span>
            </div>
            ${v.proof_link ? `<a href="${escapeHtml(v.proof_link)}" target="_blank" style="font-size:0.85em; color:#81c784; display:block; margin-top:4px;">🎥 Ссылка на видео</a>` : ''}
            ${deleteBtn}
        `;
        container.appendChild(div);
    });
}

// ==========================================
// 14. ЛОГИКА КАЛЕНДАРЯ ИСТОРИИ
// ==========================================

let currentCalMonth = new Date().getMonth();
let currentCalYear = new Date().getFullYear();
let availableSnapshots = [];

window.initCalendar = async () => {
    try {
        const data = await sbFetch('daily_snapshots?select=snapshot_date');
        availableSnapshots = data.map(d => d.snapshot_date);
    } catch (e) {
        console.error("Ошибка загрузки дат снимков", e);
    }

    const dateInput = document.getElementById('historyDate');
    if (dateInput) {
        const today = new Date();
        const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        dateInput.min = '2025-07-15';
        dateInput.max = todayStr;
    }

    renderCalendar();
};

window.renderCalendar = () => {
    const mainContainer = document.getElementById('timelineCalendar');
    if (!mainContainer) return;

    mainContainer.innerHTML = `
        <div class="calendar-month" style="max-width: 320px; margin: 0 auto; background: #1e1e2b; padding: 15px; border-radius: 8px;">
            <div id="monthYearDisplay" style="text-align: center; margin-bottom: 15px; display: flex; justify-content: center; gap: 10px;"></div>
            
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; text-align: center; color: #4fc3f7; font-weight: bold; font-size: 0.85em; margin-bottom: 8px;">
                <div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>
            </div>
            
            <div id="calendarGrid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; justify-items: center;"></div>
        </div>
    `;

    const calendarGrid = document.getElementById('calendarGrid');
    const monthYearDisplay = document.getElementById('monthYearDisplay');

    const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    const today = new Date();
    const currentYearReal = today.getFullYear();

    let yearOptions = '';
    for (let y = 2025; y <= currentYearReal; y++) {
        yearOptions += `<option value="${y}" ${y === currentCalYear ? 'selected' : ''}>${y}</option>`;
    }

    let monthOptions = '';
    for (let m = 0; m < 12; m++) {
        if (currentCalYear === 2025 && m < 6) continue;
        if (currentCalYear === currentYearReal && m > today.getMonth()) continue;
        monthOptions += `<option value="${m}" ${m === currentCalMonth ? 'selected' : ''}>${monthNames[m]}</option>`;
    }

    monthYearDisplay.innerHTML = `
        <select id="calMonthSelect" onchange="jumpToMonth()" style="background:#2a2a3b; color:white; border:1px solid #ff9800; padding:6px; border-radius:4px; cursor:pointer; outline:none; font-size: 14px;">
            ${monthOptions}
        </select>
        <select id="calYearSelect" onchange="jumpToYear()" style="background:#2a2a3b; color:white; border:1px solid #ff9800; padding:6px; border-radius:4px; cursor:pointer; outline:none; font-size: 14px;">
            ${yearOptions}
        </select>
    `;

    const firstDay = new Date(currentCalYear, currentCalMonth, 1).getDay();
    const daysInMonth = new Date(currentCalYear, currentCalMonth + 1, 0).getDate();
    let startDay = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < startDay; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'calendar-day';
        emptyDiv.style.visibility = 'hidden';
        calendarGrid.appendChild(emptyDiv);
    }

    const minDate = new Date(2025, 6, 15);
    const todayLimit = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    // Получаем текущую выбранную дату в режиме машины времени
    const dateInput = document.getElementById('historyDate');
    const selectedDateStr = dateInput ? dateInput.value : null;

    for (let i = 1; i <= daysInMonth; i++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'calendar-day';
        dayDiv.textContent = i;

        dayDiv.style.width = '35px';
        dayDiv.style.height = '35px';
        dayDiv.style.display = 'flex';
        dayDiv.style.alignItems = 'center';
        dayDiv.style.justifyContent = 'center';

        const dateStr = `${currentCalYear}-${String(currentCalMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const currentDateObj = new Date(currentCalYear, currentCalMonth, i);

        if (currentDateObj < minDate || currentDateObj > todayLimit) {
            dayDiv.classList.add('disabled');
        } else {
            dayDiv.style.cursor = 'pointer';
            dayDiv.onclick = () => {
                const dateInput = document.getElementById('historyDate');
                if (dateInput) dateInput.value = dateStr;
                window.loadDateSnapshot();
            };

            // Получаем текущую дату из инпута (или из состояния)
            const dateInput = document.getElementById('historyDate');
            const isSelected = (dateInput && dateInput.value === dateStr) || (state.currentSnapshotDate === dateStr);

            if (isSelected) {
                // 1. СНАЧАЛА красим выбранную дату в жёлтый (перебивая синий)
                dayDiv.style.background = '#ff9800';
                dayDiv.style.borderColor = '#ff9800';
                dayDiv.style.color = '#fff';
                dayDiv.style.fontWeight = 'bold';
            } else if (availableSnapshots.includes(dateStr)) {
                // 2. ИНАЧЕ, если просто есть снапшот - красим в синий
                dayDiv.style.background = '#2196f3';
                dayDiv.style.borderColor = '#64b5f6';
                dayDiv.style.color = '#fff';
                dayDiv.style.fontWeight = 'bold';
            }
        }

        if (currentDateObj.getTime() === todayLimit.getTime()) {
            dayDiv.classList.add('today');
        }

        // Если эта дата выбрана в инпуте, добавляем ей класс selected
        if (dateStr === selectedDateStr) {
            dayDiv.classList.add('selected');
        }

        calendarGrid.appendChild(dayDiv);
    }
};

window.jumpToMonth = () => {
    currentCalMonth = parseInt(document.getElementById('calMonthSelect').value);
    renderCalendar();
};

window.jumpToYear = () => {
    const newYear = parseInt(document.getElementById('calYearSelect').value);
    currentCalYear = newYear;

    if (newYear === 2025) {
        currentCalMonth = 6;
    } else {
        currentCalMonth = 0;
    }

    renderCalendar();
};

window.changeMonth = (dir) => {
    currentCalMonth += dir;
    if (currentCalMonth < 0) { currentCalMonth = 11; currentCalYear--; }
    if (currentCalMonth > 11) { currentCalMonth = 0; currentCalYear++; }

    const today = new Date();
    if (currentCalYear < 2025 || (currentCalYear === 2025 && currentCalMonth < 6)) {
        currentCalYear = 2025; currentCalMonth = 6;
    }
    if (currentCalYear > today.getFullYear() || (currentCalYear === today.getFullYear() && currentCalMonth > today.getMonth())) {
        currentCalYear = today.getFullYear(); currentCalMonth = today.getMonth();
    }

    renderCalendar();
};

window.prevDay = () => {
    const dateInput = document.getElementById('historyDate');
    if (!dateInput || !dateInput.value) return;
    const d = new Date(dateInput.value);
    d.setDate(d.getDate() - 1);
    dateInput.value = d.toISOString().split('T')[0];
    window.loadDateSnapshot();
};

window.nextDay = () => {
    const dateInput = document.getElementById('historyDate');
    if (!dateInput || !dateInput.value) return;
    const d = new Date(dateInput.value);
    d.setDate(d.getDate() + 1);
    const today = new Date().toISOString().split('T')[0];
    if (d.toISOString().split('T')[0] > today) return;
    dateInput.value = d.toISOString().split('T')[0];
    window.loadDateSnapshot();
};

window.loadYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateInput = document.getElementById('historyDate');
    if (dateInput) dateInput.value = d.toISOString().split('T')[0];
    window.loadDateSnapshot();
};

window.loadToday = () => {
    const dateInput = document.getElementById('historyDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    window.loadDateSnapshot();
};

// ==========================================
// 15. ЗАПУСК ПРИЛОЖЕНИЯ
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // Создаем кнопку входа
    createLoginButton();

    // Скрываем кнопки администратора по умолчанию
    const addBtn = document.getElementById('addBtn');
    if (addBtn) addBtn.style.display = 'none';

    const ratingControls = document.querySelector('.rating-controls');
    if (ratingControls) ratingControls.style.display = 'none';

    // Проверяем сохраненную сессию
    await checkSavedSession();

    // Запускаем основное приложение
    await init();
});

console.log('GDL loaded, count:', state.globalDemonlist.length);
console.log('First 3 GDL entries:', state.globalDemonlist.slice(0, 3));
