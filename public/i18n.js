// Языки интерфейса. Игра написана по-русски, а здесь — переводы.
// Работает так: следим за всем текстом на странице (и тем, что игра и сервер добавляют потом)
// и подменяем русские фразы переводом. Фразы с переменными записаны шаблонами: {0}, {1}, ...
// Чтобы добавить язык — добавь его в LANGS и словарь DICT[код] с теми же ключами.
(() => {
  const LANGS = { ru: 'Русский', en: 'English' };
  let lang = null;
  try { lang = localStorage.getItem('sa_lang'); } catch {}
  if (!LANGS[lang]) lang = (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

  const DICT = {};
  DICT.en = {
    // ---------- меню ----------
    '📱↻ Поверни телефон горизонтально': '📱↻ Turn your phone sideways',
    'Если экран не поворачивается — включи автоповорот в шторке телефона': 'If the screen does not rotate, turn on auto-rotate in your phone’s quick settings',
    'iPhone: открой Пункт управления (свайп из правого верхнего угла) и выключи замок поворота 🔒': 'iPhone: open Control Center (swipe down from the top-right corner) and turn off Rotation Lock 🔒',
    '↻ Повернуть экран': '↻ Rotate screen', 'Играть вертикально': 'Play in portrait', '✕ Выйти в меню': '✕ Back to menu',
    'Играть': 'Play', 'Инвентарь': 'Inventory', 'Магазин': 'Shop', 'Профиль': 'Profile', 'Настройки': 'Settings',
    'Золото: за убийства, победы и MVP': 'Gold: for kills, wins and MVPs', 'Твой ник': 'Your nickname',
    'Командный бой до 6×6 · раунды до': 'Team battle up to 6v6 · first to', 'побед': 'wins',
    'Где играть': 'Where to play', 'Онлайн': 'Online', 'общий сервер': 'shared server', 'С ботами': 'With bots',
    'оффлайн, только ты': 'offline, just you', '1 на 1': '1 vs 1', 'лобби с другом': 'lobby with a friend',
    'Карта': 'Map', 'Режим игры': 'Game mode', '💣 Закладка бомбы': '💣 Bomb defusal',
    'заложить или разминировать': 'plant or defuse', 'Командный бой': 'Team deathmatch', 'убить всех противников': 'eliminate the enemy team',
    'Сложность ботов': 'Bot difficulty', 'Лёгкий': 'Easy', 'Средний': 'Normal', 'Сложный': 'Hard', 'Эксперт': 'Expert',
    'Медленно реагируют и часто мажут — для разминки.': 'Slow to react and miss a lot — good for warming up.',
    'Обычные соперники: реагируют за полсекунды.': 'Regular opponents: react in half a second.',
    'Быстрая реакция, метко стреляют, чаще в голову.': 'Fast reactions, accurate, aim for the head more often.',
    'Почти мгновенная реакция и много хедшотов. Удачи!': 'Near-instant reactions and lots of headshots. Good luck!',
    'Размер команд': 'Team size', 'Управление': 'Controls',
    'движение': 'move', 'Пробел': 'Space', 'прыжок': 'jump', 'тихий шаг': 'walk quietly', 'присесть': 'crouch',
    'ЛКМ': 'LMB', 'ПКМ': 'RMB', 'стрельба': 'shoot', 'осмотр оружия': 'inspect weapon', 'прицел': 'aim',
    'перезарядка': 'reload', 'основное, пистолет, нож': 'primary, pistol, knife', 'таблица': 'scoreboard', 'чат': 'chat',
    'сменить команду': 'switch team', 'полный экран': 'fullscreen', 'выход в меню': 'back to menu',
    'пауза и настройки': 'pause and settings', 'сменить руку': 'switch hands',
    '(держать) заложить / разминировать бомбу': '(hold) plant / defuse the bomb', 'магазин (в начале раунда)': 'buy menu (start of round)',
    'гранаты: ЛКМ — далеко, ПКМ — близко': 'grenades: LMB — far, RMB — near', 'с AWP — прицел (2 уровня)': 'with AWP — scope (2 levels)', 'выбросить оружие (подобрать — пройти рядом)': 'drop weapon (walk over a gun to pick it up)',
    'поднять оружие, на которое смотришь (поменять на своё)': 'pick up the gun you look at (swap with yours)',
    'E — поменять {0} на {1}': 'E — swap {0} for {1}', 'E — подобрать {0}': 'E — pick up {0}',
    'зажать +': 'hold +', 'и мышь в ту же сторону — бхоп': 'and turn the mouse the same way — bhop',
    'Ботов можно менять прямо в игре, в чате:': 'You can change bots right in the game chat:',
    'размер команд ·': 'team size ·', 'сменить карту ·': 'change map ·', 'режим': 'mode',
    'ИГРАТЬ': 'PLAY', 'СОЗДАТЬ ЛОББИ': 'CREATE LOBBY', 'ИДЁТ ИГРА': 'IN GAME', 'ЖДЁМ ХОЗЯИНА': 'WAITING FOR HOST',
    'ЖДЁМ СОПЕРНИКА': 'WAITING FOR OPPONENT', 'НАЧАТЬ': 'START',
    'Соединение с сервером потеряно': 'Lost connection to the server',
    // карты
    'Пустыня': 'Desert', 'Склад': 'Warehouse', 'Деревня': 'Village', 'Каньон': 'Canyon',
    'Открытая карта: центр, коридоры, две точки по углам': 'Open map: a mid, corridors and two sites in the corners',
    'Три прохода между стеллажами, узкие входы на точки': 'Three lanes between the racks, narrow entrances to the sites',
    'Дома с дверями и окнами, точка B внутри амбара': 'Houses with doors and windows, site B inside the barn',
    'Лабиринт из скал и извилистые проходы на закате': 'A maze of rocks and winding paths at sunset',
    // инвентарь
    'Персонаж': 'Character', 'Спецназ': 'Counter-Terrorists', 'Террорист': 'Terrorist', 'Террористы': 'Terrorists',
    'Оружие — выбери, чтобы сменить скин': 'Weapons — pick one to change its skin', 'Нож': 'Knife', 'Окраска ножа': 'Knife finish',
    'Винтовка': 'Rifle', 'Снайперская': 'Sniper', 'Пистолет': 'Pistol', 'Стандарт': 'Default',
    'Пистолет-пулемёт': 'SMG', 'Дробовик': 'Shotgun', 'ПП и дробовики': 'SMGs & Shotguns',
    'Городской камуфляж': 'Urban Camo', 'Киберпанк': 'Cyberpunk', 'Вой': 'Howl', 'Песчаная буря': 'Sandstorm',
    'Токсин': 'Toxic', 'Охотник': 'Hunter', 'Золотая дробь': 'Golden Buckshot',
    'Ночной рейд': 'Night Raid', 'Неоновая волна': 'Neon Wave', 'Пожар': 'Wildfire', 'Хром': 'Chrome', 'Пламя': 'Flame',
    'Скинов пока нет — загляни в магазин': 'No skins yet — check out the shop', '🔍 Осмотреть в 3D': '🔍 Inspect in 3D', 'Осмотреть в 3D': 'Inspect in 3D',
    'Есть у всех': 'Everyone has it', 'Открыт · {0} убийств': 'Unlocked · {0} kills', '🔒 {0} / {1} убийств': '🔒 {0} / {1} kills',
    'Скелет': 'Skeleton', 'Керамбит': 'Karambit', 'Бабочка': 'Butterfly', 'Нож-скелет': 'Skeleton Knife', 'Стилет': 'Stiletto', 'M9 Байонет': 'M9 Bayonet',
    '{0} откроется за {1} убийств — осталось {2}': '{0} unlocks at {1} kills — {2} to go',
    'Сначала открой нож «{0}» — {1} убийств': 'Unlock the {0} first — {1} kills',
    // магазин и кейсы
    '🪙 Золото даётся за игру: убийства, помощь, победы в раундах, MVP и победу в матче. Нажми на скин, чтобы примерить его на персонаже.':
      '🪙 You earn gold by playing: kills, assists, round wins, MVPs and match wins. Click a skin to try it on your character.',
    'Ежедневная награда': 'Daily reward', 'Кейсы': 'Cases', 'Скины': 'Skins', 'Все': 'All', 'Ножи': 'Knives', 'Агенты': 'Agents',
    'Забрать 🪙 {0}': 'Claim 🪙 {0}', 'Серия: {0}-й день подряд 🔥': 'Streak: day {0} in a row 🔥',
    'Заходи каждый день — награда растёт': 'Come back every day — the reward grows',
    'Через {0} ч {1} мин': 'In {0} h {1} min', 'Серия: {0} д. · завтра будет 🪙 {1}': 'Streak: {0} d · tomorrow 🪙 {1}',
    'Оружейный кейс': 'Weapon Case', 'Скины на всё огнестрельное оружие': 'Skins for every gun',
    'Ножевой кейс': 'Knife Case', 'Всё подряд и шанс 15% на редкий нож': 'Everything, plus a 15% chance of a rare knife',
    'Кейс агентов': 'Agent Case', 'Персонажи за спецназ и террористов': 'Characters for both teams',
    'Смотреть · 🪙 {0}': 'View · 🪙 {0}', 'Открыть · 🪙 {0}': 'Open · 🪙 {0}', 'Не хватает 🪙 {0}': 'Need 🪙 {0} more',
    'Назад': 'Back', 'Забрать': 'Collect', 'Есть': 'Owned', 'есть': 'owned', 'бесплатно': 'free',
    'Купить · 🪙 {0}': 'Buy · 🪙 {0}', '✓ Надет': '✓ Equipped', 'Есть · надеть': 'Owned · equip', 'Есть · 🔒 {0} убийств': 'Owned · 🔒 {0} kills',
    '{0} · уже был — вернули 🪙 {1}': '{0} · duplicate — refunded 🪙 {1}', '{0} · добавлен в инвентарь': '{0} · added to inventory',
    '{0} · добавлен в инвентарь · 🔒 нож откроется за {1} убийств': '{0} · added to inventory · 🔒 knife unlocks at {1} kills',
    'Без скина': 'No skin', '{0} · есть у тебя': '{0} · you own it',
    'Тяни мышью — вращать · колёсико — приблизить · двойной клик — сбросить': 'Drag to rotate · scroll to zoom · double-click to reset',
    // редкости и скины
    'Редкий': 'Rare', 'Эпический': 'Epic', 'Легендарный': 'Legendary', '★ Особый': '★ Special', 'Обычный': 'Common',
    'Пустынный камуфляж': 'Desert Camo', 'Синий лёд': 'Blue Ice', 'Красная линия': 'Redline', 'Тигр': 'Tiger',
    'Огненный змей': 'Fire Serpent', 'Лесной': 'Forest', 'Неон': 'Neon', 'Азимов': 'Asimov', 'Драконья история': 'Dragon Lore',
    'Город': 'City', 'Неонуар': 'Neo-Noir', 'Подтверждённое': 'Kill Confirmed', 'Ночь': 'Night', 'Кровавая паутина': 'Crimson Web',
    'Золото': 'Gold', 'Дамасская сталь': 'Damascus Steel', 'Ультрафиолет': 'Ultraviolet', 'Градиент': 'Fade', 'Допплер': 'Doppler',
    'Золотой': 'Golden', 'Штурмовик SWAT': 'SWAT Assaulter', 'Морской котик': 'Navy SEAL', 'Агент ФБР': 'FBI Agent',
    'Арктический отряд': 'Arctic Squad', 'Кибер-спецназ': 'Cyber Ops', 'Золотой командир': 'Golden Commander',
    'Уличный': 'Street Thug', 'Пустынный': 'Desert Raider', 'Пират': 'Pirate', 'Партизан': 'Guerrilla', 'Череп': 'Skull',
    'Демон': 'Demon', 'Золотая маска': 'Golden Mask', 'Агент спецназа': 'CT Agent', 'Агент террористов': 'T Agent',
    // профиль и друзья
    'Твой код для друзей:': 'Your friend code:', 'Копировать': 'Copy', 'Добавить друга': 'Add a friend',
    'Ник#1234 или просто 1234': 'Name#1234 or just 1234', 'Добавить': 'Add', 'Друзья': 'Friends', 'Заявки': 'Requests',
    'Убийств': 'Kills', 'Смертей': 'Deaths', 'У/С': 'K/D', 'Матчей': 'Matches', 'Побед': 'Wins', '% побед': 'Win %',
    'в сети': 'online', 'в лобби': 'in lobby', 'в игре': 'in game', 'не в сети': 'offline',
    'хочет в друзья': 'wants to be friends', 'заявка отправлена': 'request sent', '{0} · {1} убийств · {2} побед': '{0} · {1} kills · {2} wins',
    '🛠 Аим + ВХ включены · F6 — выключить': '🛠 Aimbot + wallhack ON · F6 — turn off',
    '🛠 F6 — включить аим и ВХ (все увидят метку 🛠 у твоего ника)': '🛠 F6 — turn on aimbot and wallhack (everyone will see 🛠 next to your name)',
    '🛠 {0} включил аим и ВХ': '🛠 {0} turned on aimbot and wallhack', '🛠 {0} выключил аим и ВХ': '🛠 {0} turned off aimbot and wallhack',
    '{0} · {1} м': '{0} · {1} m',
    '🛠 F6 — панель читов (все увидят метку 🛠 у твоего ника)': '🛠 F6 — cheat panel (everyone will see 🛠 next to your name)',
    '🛠 {0} включил читы': '🛠 {0} turned cheats on', '🛠 {0} выключил читы': '🛠 {0} turned cheats off',
    '🛠 Инструменты': '🛠 Tools', 'F6 или Esc — закрыть · у тебя в таблице видна метка 🛠': 'F6 or Esc — close · everyone sees 🛠 next to you',
    '🎯 Аим': '🎯 Aimbot', 'наводка на голову, без отдачи и разброса': 'locks onto heads, no recoil or spread',
    '👁 ВХ': '👁 Wallhack', 'враги видны сквозь стены': 'see enemies through walls',
    '⚡ Скорострельность': '⚡ Rapid fire', 'очередью из любого оружия, бесконечные патроны': 'full-auto any gun, infinite ammo',
    '🧱 Стрельба сквозь стены': '🧱 Shoot through walls', 'пули проходят через стены и ящики': 'bullets pass through walls and crates',
    '🕊 Полёт': '🕊 Fly', 'пробел — вверх, Ctrl/C — вниз': 'Space — up, Ctrl/C — down',
    '👻 Сквозь стены': '👻 Noclip', 'ходить через стены и ящики': 'walk through walls and crates',
    '🏃 Скорость': '🏃 Speed', 'Выключить всё': 'Turn all off', 'ВКЛ': 'ON', 'выкл': 'off',
    // ранги, достижения, лидеры, итоги матча
    'Ранг 1 на 1: {0}': '1v1 rank: {0}', 'Рейтинг {0} · матчей 1 на 1: {1}, побед: {2}': 'Rating {0} · 1v1 matches: {1}, wins: {2}',
    'Новичок': 'Rookie', 'Боец': 'Fighter', 'Ветеран': 'Veteran', 'Мастер': 'Master', 'Элита': 'Elite', 'Легенда': 'Legend',
    'Достижения': 'Achievements', '· {0} из {1}': '· {0} of {1}', 'Таблица лидеров': 'Leaderboard', 'Рейтинг 1 на 1': '1v1 rating',
    'Пока никто не сыграл 1 на 1 — сыграй первым!': 'Nobody has played 1v1 yet — be the first!', 'Пока пусто': 'Empty so far',
    'Получено · награда 🪙 {0}': 'Unlocked · reward 🪙 {0}', 'Награда: 🪙 {0}': 'Reward: 🪙 {0}',
    '🏆 Достижение «{0}»: {1} · 🪙 +{2}': '🏆 Achievement “{0}”: {1} · 🪙 +{2}', '🏆 Достижение: {0} (🪙 +{1})': '🏆 Achievement: {0} (🪙 +{1})',
    'Первая кровь': 'First Blood', 'Первое убийство': 'Your first kill', 'Сотня': 'Hundred', '100 убийств': '100 kills',
    'Машина войны': 'War Machine', '1000 убийств': '1000 kills', 'В голову!': 'Headhunter', '50 хедшотов': '50 headshots',
    'Мясник': 'Butcher', '10 убийств ножом': '10 knife kills', 'Глаз орла': 'Eagle Eye', '25 убийств с AWP': '25 AWP kills',
    'Сквозь стены': 'Through Walls', '10 убийств прострелом': '10 wallbang kills', 'Без оптики': 'No Scope Needed', '10 убийств из AWP без прицела': '10 no-scope AWP kills', 'Акробат': 'Acrobat', '5 убийств в прыжке': '5 jumping kills',
    'Эйс': 'Ace', 'Убить всю команду врага (3+) за раунд': 'Kill the whole enemy team (3+) in one round', 'Звезда': 'Star',
    '10 раз MVP раунда': 'Round MVP 10 times', 'Подрывник': 'Bomber', 'Заложить бомбу 10 раз': 'Plant the bomb 10 times',
    'Сапёр': 'Sapper', 'Разминировать 5 бомб': 'Defuse 5 bombs', 'Победитель': 'Winner', 'Выиграть 10 матчей': 'Win 10 matches',
    'Достичь 10 уровня': 'Reach level 10', 'Не один': 'Not Alone', 'Добавить друга': 'Add a friend', 'Дуэлянт': 'Duelist',
    'Выиграть матч 1 на 1': 'Win a 1v1 match', 'Получить ранг «Легенда» в 1 на 1': 'Reach the Legend rank in 1v1',
    'ПОБЕДА': 'VICTORY', 'ПОРАЖЕНИЕ': 'DEFEAT', 'ХС%': 'HS%', 'Процент хедшотов': 'Headshot percentage',
    '★ MVP матча: {0} — {1} убийств, {2} раз MVP раунда': '★ Match MVP: {0} — {1} kills, round MVP {2} times',
    'Рейтинг {0}': 'Rating {0}', 'Новый матч начнётся через несколько секунд': 'The next match starts in a few seconds',
    // уровни и задания
    'Уровень профиля': 'Profile level', 'Уровень {0}': 'Level {0}', '{0} / {1} XP': '{0} / {1} XP',
    'За уровень {0}: 🪙 {1}': 'For level {0}: 🪙 {1}', 'За уровень {0}: 🪙 {1} + {2}': 'For level {0}: 🪙 {1} + {2}',
    '⭐ Уровень {0}! Награда: 🪙 {1}': '⭐ Level {0}! Reward: 🪙 {1}', '⭐ Уровень {0}! Награда: 🪙 {1} + {2}': '⭐ Level {0}! Reward: 🪙 {1} + {2}',
    '⭐ Новый уровень {0}! 🪙 +{1}': '⭐ New level {0}! 🪙 +{1}', '⭐ Новый уровень {0}! 🪙 +{1} и бесплатный кейс': '⭐ New level {0}! 🪙 +{1} and a free case',
    '⭐ Уровень {0} · {1}': '⭐ Level {0} · {1}', '{0} · ⭐ {1} · {2} убийств': '{0} · ⭐ {1} · {2} kills',
    '+{0} XP {1}': '+{0} XP {1}', 'хедшот': 'headshot', 'матч сыгран': 'match played',
    'Задания дня': 'Daily missions', '· новые через {0} ч': '· new in {0} h', '✓ Получено': '✓ Claimed',
    '🎁 Бесплатных: {0}': '🎁 Free: {0}', 'Открыть бесплатно ({0})': 'Open for free ({0})',
    'Убей {0} врагов': 'Kill {0} enemies', '{0} убийств в голову': '{0} headshot kills', 'Выиграй {0} раундов': 'Win {0} rounds',
    'Стань MVP {0} раза': 'Become MVP {0} times', '{0} убийства с AWP': '{0} kills with the AWP', 'Убей врага ножом': 'Kill an enemy with a knife',
    '{0} убийств из MP5': '{0} kills with the MP5', '{0} убийства из дробовика': '{0} kills with the shotgun', '{0} убийств из M4': '{0} kills with the M4',
    'Убийство в прыжке': 'Kill while jumping', '{0} убийства сквозь стену': '{0} wallbang kills',
    '✅ Задание выполнено: {0} — забери 🪙 {1} в профиле': '✅ Mission complete: {0} — claim 🪙 {1} in your profile',
    '✅ Задание выполнено: {0}': '✅ Mission complete: {0}',
    'Принять': 'Accept', 'Отменить': 'Cancel', 'Нет': 'No', 'Да': 'Yes', 'Позвать 1×1': 'Invite 1v1',
    '· в сети {0} из {1}': '· {0} of {1} online', 'Удалить {0} из друзей?': 'Remove {0} from friends?',
    'Пока никого. Отправь другу свой код — пусть добавит тебя, или впиши его код выше.': 'Nobody yet. Send a friend your code so they can add you, or enter their code above.',
    'Загрузка…': 'Loading…', '＋ Добавить в друзья': '＋ Add friend', 'Принять заявку': 'Accept request', 'Заявка отправлена': 'Request sent',
    '✓ В друзьях': '✓ Friends', 'Это ты': "That's you", 'Код': 'Code', '{0} скопирован: {1}': '{0} copied: {1}',
    'Нет связи с сервером — переподключаемся…': 'No connection to the server — reconnecting…',
    '🔓 Открыт нож: {0}! Выбери его в инвентаре': '🔓 Knife unlocked: {0}! Pick it in your inventory', '🔓 Открыт нож: {0} ({1} убийств)': '🔓 Knife unlocked: {0} ({1} kills)',
    '✉ {0} зовёт тебя в лобби 1 на 1 (код {1}) — выйди в меню: K K': '✉ {0} invites you to a 1v1 lobby (code {1}) — go to the menu: K K',
    '✉ {0} зовёт тебя в лобби 1 на 1': '✉ {0} invites you to a 1v1 lobby',
    'Игрок с номером «{0}» не найден': 'No player with code “{0}”', 'Это твой собственный номер 🙂': "That's your own code 🙂",
    '{0} уже у тебя в друзьях': '{0} is already your friend', 'Заявка уже отправлена': 'Request already sent',
    'Слишком много друзей или заявок': 'Too many friends or requests', 'Заявка отправлена: {0}': 'Request sent: {0}',
    '{0} хочет добавить тебя в друзья': '{0} wants to add you as a friend', '{0} принял заявку в друзья': '{0} accepted your friend request',
    // лобби
    '＋ Создать лобби': '＋ Create lobby', 'Или войти по коду': 'Or join with a code', 'КОД': 'CODE', 'Войти': 'Join',
    'Код лобби': 'Lobby code', 'Выйти': 'Leave', 'Позвать друга': 'Invite a friend', 'Правила матча': 'Match rules',
    'Ждём соперника…': 'Waiting for an opponent…', '· меняешь ты': '· you set them', '· меняет хозяин ★': '· the host ★ sets them',
    'Нет друзей в сети. Скажи другу код лобби — он введёт его в «1 на 1».': 'No friends online. Tell a friend the lobby code — they enter it under “1 vs 1”.',
    'Режим': 'Mode', 'Бой': 'Deathmatch', '💣 Бомба': '💣 Bomb', 'Оружие': 'Weapons', 'Закупка': 'Buy', 'Скорость бега': 'Run speed',
    'Высота прыжка': 'Jump height', 'Гравитация': 'Gravity', '🌙 Луна': '🌙 Moon', 'Обычная': 'Normal', 'Тяжёлая': 'Heavy',
    'Здоровье': 'Health', 'Раундов до победы': 'Rounds to win', 'Только в голову': 'Headshots only', 'Деньги': 'Money',
    'Обычные': 'Normal', 'Без лимита': 'Unlimited', 'Гранаты': 'Grenades',
    'Лобби с таким кодом нет': 'No lobby with that code', 'Лобби уже заполнено (1 на 1)': 'The lobby is full (1v1)',
    'В этом лобби уже идёт игра': 'A game is already running in this lobby', '{0} вышел из лобби': '{0} left the lobby',
    'Друг не в сети': 'Your friend is offline', 'В лобби уже двое': 'The lobby already has two players',
    'Приглашение отправлено: {0}': 'Invite sent: {0}', 'Нужен второй игрок — пригласи друга или дай ему код лобби': 'You need a second player — invite a friend or give them the lobby code',
    'Эта игра лобби уже закончилась': 'This lobby game has already ended', 'Лобби 1 на 1 · {0}': '1v1 lobby · {0}',
    'В лобби 1 на 1 команды не меняются': "Teams can't be switched in a 1v1 lobby", 'В лобби правила меняет хозяин в меню лобби': 'In a lobby, the host changes the rules in the lobby menu',
    // в игре
    'РАЗМИНКА': 'WARMUP', 'до': 'first to', 'Сообщение...': 'Message...', 'Спецназ (CT)': 'Counter-Terrorists (CT)', 'Террористы (T)': 'Terrorists (T)',
    'Игрок': 'Player', 'Убийства': 'Kills', 'У': 'K', 'Помощь': 'Assists', 'П': 'A', 'Смерти': 'Deaths', 'С': 'D', 'MVP раунда': 'Round MVP',
    'Выбери команду': 'Choose a team', 'или': 'or', '— закрыть': '— close', 'Пауза': 'Paused', 'Продолжить': 'Resume',
    '⚙ Настройки': '⚙ Settings', 'или кликни по экрану': 'or click the screen', 'Игроки в матче — нажми, чтобы открыть профиль': 'Players in the match — click to open a profile',
    'B или Esc — закрыть': 'B or Esc — close', 'Пистолеты': 'Pistols', 'Винтовки': 'Rifles', 'Снаряжение': 'Equipment',
    'Бронежилет': 'Kevlar', 'Жилет + шлем': 'Kevlar + Helmet', 'Бронежилет и шлем': 'Kevlar and helmet',
    'Осколочная': 'HE Grenade', 'Флешка': 'Flashbang', 'Дымовая': 'Smoke Grenade',
    'Нажми K ещё раз, чтобы выйти в меню': 'Press K again to go back to the menu',
    'Оффлайн · {0} · {1}×{2}': 'Offline · {0} · {1}v{2}', 'Раунд уже идёт': 'Round in progress', 'Ждём следующего раунда...': 'Waiting for the next round...',
    'Ты сменил команду': 'You switched teams', 'РАУНД {0} · ЗАКЛАДКА БОМБЫ': 'ROUND {0} · BOMB DEFUSAL', 'РАУНД {0}': 'ROUND {0}',
    'КАРТА: {0}': 'MAP: {0}', 'БОМБА ЗАЛОЖЕНА НА ТОЧКЕ {0}': 'BOMB PLANTED AT SITE {0}', '💣 {0} заложил бомбу на точке {1}': '💣 {0} planted the bomb at site {1}',
    '✂ {0} разминировал бомбу': '✂ {0} defused the bomb', 'БОМБА ВЗОРВАНА — ПОБЕДА ТЕРРОРИСТОВ': 'BOMB EXPLODED — TERRORISTS WIN',
    'БОМБА ОБЕЗВРЕЖЕНА — ПОБЕДА СПЕЦНАЗА': 'BOMB DEFUSED — COUNTER-TERRORISTS WIN', 'ВРЕМЯ ВЫШЛО — ПОБЕДА СПЕЦНАЗА': 'TIME RAN OUT — COUNTER-TERRORISTS WIN',
    'НИЧЬЯ': 'DRAW', '{0} ВЫИГРАЛИ РАУНД': '{0} WIN THE ROUND', 'разминировал бомбу': 'defused the bomb', 'заложил бомбу': 'planted the bomb',
    'больше всех убийств ({0})': 'most kills ({0})', '★ MVP раунда: {0} — {1}': '★ Round MVP: {0} — {1}',
    '{0} убийство': '{0} kill', '{0} убийства': '{0} kills', '{0} убийств': '{0} kills',
    'победа в раунде': 'round win', 'победа в матче': 'match win', 'проигрыш раунда': 'round loss', 'за убийство': 'kill reward',
    'убийство': 'kill', 'помощь': 'assist', 'ПОБЕДА В МАТЧЕ!': 'MATCH WON!', 'ПОРАЖЕНИЕ В МАТЧЕ': 'MATCH LOST',
    '{0} · M — сменить': '{0} · M — switch', 'Лобби': 'Lobby', 'Возрождение через {0}...': 'Respawning in {0}...',
    'в голову': 'headshot', 'прострел': 'wallbang', 'в прыжке': 'jumping', 'без прицела': 'no-scope',
    'Тебя убил {0} с помощью {1} ({2})': '{0} killed you with help from {1} ({2})', 'Тебя убил {0} с помощью {1}': '{0} killed you with help from {1}',
    'Тебя убил {0} ({1})': '{0} killed you ({1})', 'Тебя убил {0}': '{0} killed you', 'Ждём конца раунда...': 'Waiting for the round to end...',
    '{0} добил {1}': '{0} finished off {1}', 'ПОМОЩЬ': 'ASSIST', 'ПОМОЩЬ ФЛЕШКОЙ': 'FLASH ASSIST',
    'УБИЙСТВО': 'KILL', 'ДВОЙНОЕ УБИЙСТВО': 'DOUBLE KILL', 'ТРОЙНОЕ УБИЙСТВО': 'TRIPLE KILL', 'УЛЬТРА УБИЙСТВО': 'ULTRA KILL',
    'Старт через {0}': 'Starting in {0}', 'Новый раунд: {0}': 'New round: {0}',
    'Ты на точке {0} — зажми E, чтобы заложить бомбу': "You're at site {0} — hold E to plant the bomb",
    'У тебя бомба — отнеси её на точку A или B': 'You have the bomb — take it to site A or B',
    'У тебя бомба — отнеси её на точку A или B (5 — взять в руки)': 'You have the bomb — take it to site A or B (5 — take it in hand)',
    'У тебя бомба — отнеси её на точку A или B (C4 — взять в руки)': 'You have the bomb — take it to site A or B (C4 — take it in hand)',
    'Бомба в руках — G, чтобы выбросить (союзник подберёт), 1–3 — убрать': 'Bomb in hand — G to drop it (a teammate can pick it up), 1–3 to put it away',
    'Бомба в руках — G, чтобы выбросить (союзник подберёт)': 'Bomb in hand — G to drop it (a teammate can pick it up)',
    'Войди через Google, чтобы прогресс, золото и скины не пропали и открывались на любом устройстве':
      'Sign in with Google so your progress, gold and skins are never lost and work on any device',
    '✓ Профиль привязан к Google': '✓ Profile linked to Google', 'Выйти': 'Sign out',
    '✓ Профиль привязан к Google — прогресс сохранится': '✓ Profile linked to Google — your progress is saved',
    'Не получилось войти через Google — попробуй ещё раз': "Couldn't sign in with Google — try again",
    '↩ продать': '↩ sell', '↩ продать +${0}': '↩ sell +${0}',
    '💣 {0} выбросил бомбу': '💣 {0} dropped the bomb', '💣 Ты подобрал бомбу': '💣 You picked up the bomb', 'Зажми E, чтобы разминировать': 'Hold E to defuse',
    'Бомба заложена на {0} — разминируй её!': 'The bomb is planted at {0} — defuse it!', 'Бомба выпала — подбери её': 'The bomb was dropped — pick it up',
    'Закладка бомбы…': 'Planting the bomb…', 'Разминирование…': 'Defusing…', 'Бомба (C4) · зажми E на точке': 'Bomb (C4) · hold E on a site',
    'Захват мыши недоступен в этом браузере: смотри по сторонам, зажав правую кнопку мыши': "Mouse capture isn't available in this browser: hold the right mouse button to look around",
    '{0} (ты)': '{0} (you)', 'бот': 'bot', 'без профиля': 'no profile', '✓ друг': '✓ friend',
    'Покупать можно только в начале раунда': 'You can only buy at the start of the round',
    'B — магазин': 'B — buy menu', 'B — магазин · {0} с': 'B — buy menu · {0} s', 'Наблюдение: {0} · ЛКМ — следующий': 'Spectating: {0} · LMB — next',
    '🪙 +{0} {1}': '🪙 +{0} {1}', '+${0} {1}': '+${0} {1}',
    // чат от сервера
    '{0} подключился': '{0} joined', '{0} вышел': '{0} left', '{0} перешёл за {1}': '{0} switched to {1}',
    'Обе команды в сборе — матч начинается!': 'Both teams are ready — the match begins!',
    'Ждём игроков в обеих командах — разминка': 'Waiting for players on both teams — warmup',
    '{0}: Боты выключены': '{0}: Bots disabled', '{0}: Команды добиваются ботами до {1} на {2}': '{0}: Teams are filled with bots up to {1}v{2}',
    '{0}: карта — {1}, новый матч': '{0}: map — {1}, new match', '{0}: режим — {1} (со следующего раунда)': '{0}: mode — {1} (from the next round)',
    'закладка бомбы': 'bomb defusal', 'командный бой': 'team deathmatch', '{0}: сложность ботов — {1}': '{0}: bot difficulty — {1}',
    'лёгкая': 'easy', 'средняя': 'normal', 'сложная': 'hard', 'эксперт': 'expert',
    'Команды: /bots 0-{0} (сейчас {1}), /diff easy|normal|hard|expert (сейчас {2}), /mode bomb|tdm (сейчас {3}), /map {4} (сейчас {5})':
      'Commands: /bots 0-{0} (now {1}), /diff easy|normal|hard|expert (now {2}), /mode bomb|tdm (now {3}), /map {4} (now {5})',
    // настройки
    'Звук': 'Sound', 'Общая громкость': 'Master volume', 'Громкость выстрелов': 'Gunshot volume', 'Графика': 'Graphics',
    'Качество': 'Quality', 'Низкое': 'Low', 'Среднее': 'Medium', 'Высокое': 'High',
    'Без теней и чуть размытее — максимум FPS на слабом компьютере.': 'No shadows and slightly blurrier — maximum FPS on a weak PC.',
    'Тени попроще, обычная чёткость.': 'Simpler shadows, normal sharpness.', 'Чёткие тени и максимальная чёткость картинки.': 'Sharp shadows and maximum image sharpness.',
    'Поле зрения (FOV)': 'Field of view (FOV)', 'Показывать FPS': 'Show FPS', 'Чувствительность мыши': 'Mouse sensitivity',
    'Чувствительность в прицеле': 'Scoped sensitivity', 'Инвертировать мышь по вертикали': 'Invert mouse Y',
    'Оружие в левой руке (клавиша H)': 'Weapon in left hand (H key)', 'Прицел': 'Crosshair', 'Цвет': 'Color', 'Размер': 'Size',
    'Сбросить': 'Reset', 'Готово': 'Done', 'Закрыть': 'Close', 'Язык': 'Language',
  };

  // Имена ботов — латиницей
  const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
    о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const translit = s => s.replace(/[а-яё]/gi, ch => {
    const t = TRANSLIT[ch.toLowerCase()] ?? ch;
    return ch === ch.toLowerCase() ? t : t.charAt(0).toUpperCase() + t.slice(1);
  });

  const CYR = /[А-Яа-яЁё]/;
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const dict = DICT[lang] || {};
  const exact = new Map(), upper = new Map(), patterns = [];
  for (const [ru, tr] of Object.entries(dict)) {
    const key = norm(ru);
    if (!/\{\d\}/.test(key)) {
      exact.set(key, tr);
      upper.set(key.toUpperCase(), tr.toUpperCase());
    } else {
      // шаблон → регулярное выражение: {0} — любой кусок текста
      const order = [];
      const re = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d)\}/g, (_, d) => { order.push(+d); return '(.+?)'; });
      patterns.push({ re: new RegExp(`^${re}$`), order, tr, len: key.length });
    }
  }
  patterns.sort((a, b) => b.len - a.len);  // длинные шаблоны — первыми (они точнее)

  function tr(text) {
    if (lang === 'ru' || !text || !CYR.test(text)) return text;
    const s = norm(text);
    if (exact.has(s)) return exact.get(s);
    if (upper.has(s)) return upper.get(s);
    if (/^BOT [А-Яа-яЁё]+$/.test(s)) return translit(s);
    const name = /^Игрок(\d+)$/.exec(s);
    if (name) return `Player${name[1]}`;
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      const parts = [];
      p.order.forEach((d, i) => { parts[d] = tr(m[i + 1]); });  // куски внутри тоже переводим (имена карт, команд...)
      return p.tr.replace(/\{(\d)\}/g, (_, d) => parts[+d] ?? '');
    }
    // составные подписи: «Керамбит · Редкий · 🔒», «в голову, прострел» — переводим по частям
    for (const sep of [' · ', ', ']) {
      if (s.includes(sep)) {
        const out = s.split(sep).map(tr).join(sep);
        if (out !== s) return out;
      }
    }
    return text;
  }

  // Перевод узла: текст (с сохранением пробелов по краям) и подписи placeholder/title
  function translateText(node) {
    const v = node.nodeValue;
    if (!CYR.test(v)) return;
    const t = tr(v);
    if (t === v) return;
    const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
    node.nodeValue = lead + t + trail;
  }
  function translateAttrs(el) {
    for (const a of ['placeholder', 'title']) {
      const v = el.getAttribute?.(a);
      if (v && CYR.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
    }
  }
  function translateTree(root) {
    if (root.nodeType === 3) return translateText(root);
    if (root.nodeType !== 1 || root.closest?.('[data-no-i18n]')) return;
    translateAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) translateText(n);
      else translateAttrs(n);
    }
  }

  window.I18N = { lang, langs: LANGS, tr, setLang(code) {
    try { localStorage.setItem('sa_lang', code); } catch {}
    location.reload();  // проще всего: страница заново строится уже на новом языке
  } };
  document.documentElement.lang = lang;
  if (lang === 'ru') return;

  const start = () => {
    translateTree(document.body);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') translateText(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
        else for (const n of m.addedNodes) translateTree(n);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
