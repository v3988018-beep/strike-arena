"""Профили, друзья и лобби 1 на 1.

Каждый браузер получает профиль: ник, номер (#1234) и секретный ключ (token),
который хранится у игрока в localStorage — по нему сервер узнаёт его при следующем входе.
Профили лежат в data/profiles.json.

Меню держит отдельное соединение /social: через него приходят заявки в друзья,
кто из друзей в сети, приглашения в лобби и настройки лобби.
"""
import asyncio
import json
import random
import secrets
import string
from pathlib import Path

from aiohttp import web, WSMsgType

DATA_FILE = Path(__file__).parent / "data" / "profiles.json"
MAX_FRIENDS = 100
MAX_REQUESTS = 50

# Настройки лобби: допустимые значения (первое — по умолчанию)
LOBBY_OPTIONS = {
    "map": None,                                   # любая карта из MAPS (проверяется в server.py)
    "mode": ["tdm", "bomb"],
    "weapons": ["buy", "rifle", "m4", "awp", "smg", "shotgun", "pistol", "deagle", "knife"],
    "speed": [1.0, 0.75, 1.25, 1.5, 2.0],
    "jump": [1.0, 0.75, 1.5, 2.0],
    "gravity": [1.0, 0.5, 1.5],
    "hp": [100, 50, 200],
    "rounds": [5, 3, 8],
    "headshot": [False, True],
    "money": ["normal", "unlimited"],
    "nades": [True, False],
}


# Уровни: на 1-й → 2-й нужно 300 опыта, дальше каждый уровень на 100 дороже
LEVEL_BASE, LEVEL_STEP = 300, 100


def level_info(xp):
    """(уровень, сколько опыта набрано на текущем уровне, сколько нужно до следующего)."""
    level, need = 1, LEVEL_BASE
    while xp >= need:
        xp -= need
        level += 1
        need = LEVEL_BASE + LEVEL_STEP * (level - 1)
    return level, xp, need


# Достижения: (id, название, что сделать, счётчик, сколько нужно, награда золотом)
ACHIEVEMENTS = [
    ("first_blood", "Первая кровь", "Первое убийство", "kills", 1, 50),
    ("kills_100", "Сотня", "100 убийств", "kills", 100, 300),
    ("kills_1000", "Машина войны", "1000 убийств", "kills", 1000, 1000),
    ("head_50", "В голову!", "50 хедшотов", "headshots", 50, 300),
    ("knife_10", "Мясник", "10 убийств ножом", "knife_kills", 10, 300),
    ("awp_25", "Глаз орла", "25 убийств с AWP", "awp_kills", 25, 400),
    ("wall_10", "Сквозь стены", "10 убийств прострелом", "wallbangs", 10, 300),
    ("noscope_10", "Без оптики", "10 убийств из AWP без прицела", "noscopes", 10, 400),
    ("jump_5", "Акробат", "5 убийств в прыжке", "jump_kills", 5, 250),
    ("ace", "Эйс", "Убить всю команду врага (3+) за раунд", "aces", 1, 500),
    ("mvp_10", "Звезда", "10 раз MVP раунда", "mvps", 10, 300),
    ("plant_10", "Подрывник", "Заложить бомбу 10 раз", "plants", 10, 250),
    ("defuse_5", "Сапёр", "Разминировать 5 бомб", "defuses", 5, 300),
    ("win_10", "Победитель", "Выиграть 10 матчей", "wins", 10, 400),
    ("level_10", "Ветеран", "Достичь 10 уровня", "level", 10, 500),
    ("friend_1", "Не один", "Добавить друга", "friends", 1, 100),
    ("duel_1", "Дуэлянт", "Выиграть матч 1 на 1", "duel_wins", 1, 300),
    ("duel_legend", "Легенда", "Получить ранг «Легенда» в 1 на 1", "elo", 1400, 1000),
]

# Ранги 1 на 1 по рейтингу (как в шахматах: победа над сильным даёт больше)
RANKS = [(0, "Новичок"), (900, "Боец"), (1000, "Ветеран"), (1100, "Мастер"), (1250, "Элита"), (1400, "Легенда")]
START_ELO, ELO_K = 1000, 32


def rank_of(elo):
    return [name for need, name in RANKS if elo >= need][-1]


def default_settings(map_id):
    s = {k: v[0] for k, v in LOBBY_OPTIONS.items() if v}
    s["map"] = map_id
    return s


class Social:
    def __init__(self, maps, default_map, start_game):
        self.maps = maps                  # карты — чтобы проверять настройку лобби
        self.default_map = default_map
        self.start_game = start_game      # server.py: создаёт игру лобби и возвращает имя комнаты
        self.profiles = {}                # id → профиль
        self.by_token = {}                # token → id
        self.sessions = {}                # id → множество соединений /social (вкладки браузера)
        self.in_game = set()              # кто сейчас в игре
        self.lobbies = {}                 # код → лобби
        self.lobby_of = {}                # id игрока → код лобби
        self.load()

    # ---------- хранение ----------
    def load(self):
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        for p in data.get("profiles", []):
            # опыт появился позже — старым профилям начисляем его за уже сделанные убийства и победы
            p["stats"].setdefault("xp", p["stats"].get("kills", 0) * 20 + p["stats"].get("wins", 0) * 100)
            p["stats"].setdefault("elo", START_ELO)
            p.setdefault("ach", [])
            self.profiles[p["id"]] = p
            self.by_token[p["token"]] = p["id"]

    def save(self):
        DATA_FILE.parent.mkdir(exist_ok=True)
        tmp = DATA_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"profiles": list(self.profiles.values())}, ensure_ascii=False),
                       encoding="utf-8")
        tmp.replace(DATA_FILE)  # сначала во временный файл — чтобы не испортить при сбое

    def new_profile(self, name):
        used = {p["tag"] for p in self.profiles.values()}
        tag = random.choice([t for t in range(1000, 10000) if t not in used])
        pid = str(tag)  # номер и есть id профиля
        p = {"id": pid, "tag": tag, "name": name, "token": secrets.token_hex(16),
             "stats": {"kills": 0, "deaths": 0, "matches": 0, "wins": 0, "xp": 0, "elo": START_ELO},
             "friends": [], "incoming": [], "outgoing": [], "ach": []}
        self.profiles[pid] = p
        self.by_token[p["token"]] = pid
        self.save()
        return p

    def pid_by_token(self, token):
        return self.by_token.get(token) if isinstance(token, str) else None

    def kills(self, pid):
        p = self.profiles.get(pid)
        return p["stats"]["kills"] if p else 0

    # ---------- статистика (вызывает игра) ----------
    def record(self, pid, **inc):
        p = self.profiles.get(pid)
        if not p:
            return
        for k, v in inc.items():
            p["stats"][k] = p["stats"].get(k, 0) + v
        self.check_achievements(pid)
        self.save()
        if pid in self.sessions:  # меню сразу видит новые убийства (открытие ножей)
            asyncio.get_event_loop().create_task(self.push_me(pid))

    def check_achievements(self, pid):
        """Новые достижения — в профиль и сразу игроку (награда золотом выдаётся в браузере)."""
        p = self.profiles.get(pid)
        if not p:
            return
        s = p["stats"]
        for aid, name, desc, key, need, gold in ACHIEVEMENTS:
            if aid in p["ach"]:
                continue
            have = (level_info(s.get("xp", 0))[0] if key == "level" else
                    len(p["friends"]) if key == "friends" else s.get(key, 0 if key != "elo" else START_ELO))
            if have >= need:
                p["ach"].append(aid)
                if pid in self.sessions:
                    asyncio.get_event_loop().create_task(self.send(pid, {
                        "type": "achievement", "id": aid, "name": name, "desc": desc, "gold": gold}))

    def duel_result(self, win_pid, lose_pid):
        """Матч 1 на 1 сыгран: рейтинг (Эло) победителю вверх, проигравшему вниз. Возвращает изменения."""
        a, b = self.profiles.get(win_pid), self.profiles.get(lose_pid)
        if not a or not b:
            return {}
        ra, rb = a["stats"].get("elo", START_ELO), b["stats"].get("elo", START_ELO)
        expect = 1 / (1 + 10 ** ((rb - ra) / 400))   # шанс победы по рейтингу
        delta = max(1, round(ELO_K * (1 - expect)))
        self.record(win_pid, elo=delta, duels=1, duel_wins=1)
        self.record(lose_pid, elo=-delta, duels=1)
        return {win_pid: delta, lose_pid: -delta}

    def leaders(self):
        """Таблица лидеров: лучшие по рейтингу 1 на 1 и по уровню."""
        ps = list(self.profiles.values())
        duel = sorted((p for p in ps if p["stats"].get("duels")), key=lambda p: -p["stats"].get("elo", START_ELO))[:10]
        lvl = sorted(ps, key=lambda p: -p["stats"].get("xp", 0))[:10]
        row = lambda p: {"id": p["id"], "name": p["name"], "tag": p["tag"], "elo": p["stats"].get("elo", START_ELO),
                         "rank": rank_of(p["stats"].get("elo", START_ELO)), "level": level_info(p["stats"].get("xp", 0))[0],
                         "kills": p["stats"].get("kills", 0), "duels": p["stats"].get("duels", 0)}
        return {"type": "leaders", "duel": [row(p) for p in duel], "level": [row(p) for p in lvl]}

    def give_xp(self, pid, amount, reason):
        """Опыт за игру: в профиль и сразу игроку — «+20 XP за убийство»."""
        if pid not in self.profiles or amount <= 0:
            return
        self.record(pid, xp=amount)
        if pid in self.sessions:
            asyncio.get_event_loop().create_task(self.send(pid, {"type": "xp", "amount": amount, "reason": reason}))

    async def set_in_game(self, pid, playing):
        if not pid:
            return
        if playing:
            self.in_game.add(pid)
        else:
            self.in_game.discard(pid)
        await self.push_friends_of(pid)

    async def lobby_game_over(self, code):
        """Все вышли из игры лобби — лобби снова ждёт старта."""
        lobby = self.lobbies.get(code)
        if lobby:
            lobby["room"] = None
            await self.push_lobby(lobby)

    # ---------- отправка ----------
    async def send(self, pid, msg):
        data = json.dumps(msg, ensure_ascii=False)
        for ws in list(self.sessions.get(pid, ())):
            try:
                await ws.send_str(data)
            except Exception:
                pass

    def status(self, pid):
        if pid not in self.sessions:
            return "offline"
        if pid in self.in_game:
            return "game"
        if pid in self.lobby_of:
            return "lobby"
        return "menu"

    def card(self, pid):
        p = self.profiles[pid]
        elo = p["stats"].get("elo", START_ELO)
        return {"id": pid, "name": p["name"], "tag": p["tag"], "status": self.status(pid), "stats": p["stats"],
                "level": level_info(p["stats"].get("xp", 0))[0], "rank": rank_of(elo), "ach": p.get("ach", [])}

    async def push_me(self, pid):
        p = self.profiles[pid]
        level, have, need = level_info(p["stats"].get("xp", 0))
        await self.send(pid, {"type": "me", "id": pid, "name": p["name"], "tag": p["tag"], "stats": p["stats"],
                              "level": level, "xpHave": have, "xpNeed": need,
                              "rank": rank_of(p["stats"].get("elo", START_ELO)), "ach": p.get("ach", []),
                              "achList": [{"id": a, "name": n, "desc": d, "gold": g, "key": k, "need": need_}
                                          for a, n, d, k, need_, g in ACHIEVEMENTS]})

    async def push_friends(self, pid):
        p = self.profiles[pid]
        cards = lambda ids: [self.card(i) for i in ids if i in self.profiles]
        await self.send(pid, {"type": "friends", "friends": cards(p["friends"]),
                              "incoming": cards(p["incoming"]), "outgoing": cards(p["outgoing"])})

    async def push_friends_of(self, pid):
        """Изменился статус игрока — его друзьям обновляем список."""
        p = self.profiles.get(pid)
        if not p:
            return
        for f in set(p["friends"]) | set(p["incoming"]) | set(p["outgoing"]):
            if f in self.sessions:
                await self.push_friends(f)

    def lobby_public(self, lobby):
        return {"code": lobby["code"], "host": lobby["host"], "settings": lobby["settings"],
                "members": [self.card(m) for m in lobby["members"]], "inGame": lobby["room"] is not None}

    async def push_lobby(self, lobby):
        for m in lobby["members"]:
            await self.send(m, {"type": "lobby", "lobby": self.lobby_public(lobby)})

    async def notice(self, pid, text):
        await self.send(pid, {"type": "notice", "text": text})

    # ---------- друзья ----------
    async def friend_add(self, pid, code):
        me = self.profiles[pid]
        digits = "".join(ch for ch in str(code).split("#")[-1] if ch.isdigit())
        other = self.profiles.get(digits)
        if not other:
            return await self.notice(pid, f"Игрок с номером «{code}» не найден")
        oid = other["id"]
        if oid == pid:
            return await self.notice(pid, "Это твой собственный номер 🙂")
        if oid in me["friends"]:
            return await self.notice(pid, f"{other['name']} уже у тебя в друзьях")
        if oid in me["incoming"]:
            return await self.friend_accept(pid, oid)  # он уже звал — просто принимаем
        if oid in me["outgoing"]:
            return await self.notice(pid, "Заявка уже отправлена")
        if len(me["friends"]) >= MAX_FRIENDS or len(other["incoming"]) >= MAX_REQUESTS:
            return await self.notice(pid, "Слишком много друзей или заявок")
        me["outgoing"].append(oid)
        other["incoming"].append(pid)
        self.save()
        await self.notice(pid, f"Заявка отправлена: {other['name']}#{other['tag']}")
        await self.notice(oid, f"{me['name']}#{me['tag']} хочет добавить тебя в друзья")
        await self.push_friends(pid)
        await self.push_friends(oid)

    async def friend_accept(self, pid, oid):
        me, other = self.profiles[pid], self.profiles.get(oid)
        if not other or oid not in me["incoming"]:
            return
        me["incoming"].remove(oid)
        if pid in other["outgoing"]:
            other["outgoing"].remove(pid)
        me["friends"].append(oid)
        other["friends"].append(pid)
        self.check_achievements(pid)
        self.check_achievements(oid)
        self.save()
        await self.notice(oid, f"{me['name']} принял заявку в друзья")
        await self.push_friends(pid)
        await self.push_friends(oid)

    async def friend_remove(self, pid, oid):
        """Удалить из друзей, отклонить заявку или отменить свою."""
        me, other = self.profiles[pid], self.profiles.get(oid)
        if not other:
            return
        for a, b in ((me, oid), (other, pid)):
            for key in ("friends", "incoming", "outgoing"):
                if b in a[key]:
                    a[key].remove(b)
        self.save()
        await self.push_friends(pid)
        await self.push_friends(oid)

    async def profile_get(self, pid, oid):
        """Карточка чужого профиля (из игры): статистика и кем он мне приходится."""
        if oid not in self.profiles:
            return
        me = self.profiles[pid]
        relation = ("self" if oid == pid else "friend" if oid in me["friends"]
                    else "incoming" if oid in me["incoming"] else "outgoing" if oid in me["outgoing"] else "none")
        await self.send(pid, {"type": "profile", **self.card(oid), "relation": relation})

    # ---------- лобби ----------
    def new_code(self):
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # без похожих O/0 и I/1
        while True:
            code = "".join(random.choice(alphabet) for _ in range(5))
            if code not in self.lobbies:
                return code

    async def lobby_create(self, pid):
        await self.lobby_leave(pid)
        code = self.new_code()
        lobby = {"code": code, "host": pid, "members": [pid],
                 "settings": default_settings(self.default_map), "room": None}
        self.lobbies[code] = lobby
        self.lobby_of[pid] = code
        await self.push_lobby(lobby)
        await self.push_friends_of(pid)
        return lobby

    async def lobby_join(self, pid, code):
        lobby = self.lobbies.get(str(code).strip().upper())
        if not lobby:
            return await self.notice(pid, "Лобби с таким кодом нет")
        if pid in lobby["members"]:
            return
        if len(lobby["members"]) >= 2:
            return await self.notice(pid, "Лобби уже заполнено (1 на 1)")
        if lobby["room"]:
            return await self.notice(pid, "В этом лобби уже идёт игра")
        await self.lobby_leave(pid)
        lobby["members"].append(pid)
        self.lobby_of[pid] = lobby["code"]
        await self.push_lobby(lobby)
        await self.push_friends_of(pid)

    async def lobby_leave(self, pid):
        code = self.lobby_of.pop(pid, None)
        lobby = self.lobbies.get(code)
        if not lobby:
            return
        lobby["members"].remove(pid)
        await self.send(pid, {"type": "lobby", "lobby": None})
        if not lobby["members"]:
            del self.lobbies[code]
        else:
            if lobby["host"] == pid:
                lobby["host"] = lobby["members"][0]   # хозяином становится оставшийся
            for m in lobby["members"]:
                await self.notice(m, f"{self.profiles[pid]['name']} вышел из лобби")
            await self.push_lobby(lobby)
        await self.push_friends_of(pid)

    async def lobby_invite(self, pid, oid):
        me = self.profiles[pid]
        if oid not in me["friends"]:
            return
        if oid not in self.sessions:
            return await self.notice(pid, "Друг не в сети")
        lobby = self.lobbies.get(self.lobby_of.get(pid)) or await self.lobby_create(pid)
        if len(lobby["members"]) >= 2:
            return await self.notice(pid, "В лобби уже двое")
        await self.send(oid, {"type": "invite", "code": lobby["code"],
                              "from": {"id": pid, "name": me["name"], "tag": me["tag"]}})
        await self.notice(pid, f"Приглашение отправлено: {self.profiles[oid]['name']}")

    async def lobby_settings(self, pid, new):
        lobby = self.lobbies.get(self.lobby_of.get(pid))
        if not lobby or lobby["host"] != pid or lobby["room"] or not isinstance(new, dict):
            return
        s = lobby["settings"]
        for k, v in new.items():
            if k == "map" and v in self.maps:
                s["map"] = v
            elif k in LOBBY_OPTIONS and LOBBY_OPTIONS[k] and v in LOBBY_OPTIONS[k]:
                s[k] = v
        await self.push_lobby(lobby)

    async def lobby_start(self, pid):
        lobby = self.lobbies.get(self.lobby_of.get(pid))
        if not lobby or lobby["host"] != pid or lobby["room"]:
            return
        if len(lobby["members"]) < 2:
            return await self.notice(pid, "Нужен второй игрок — пригласи друга или дай ему код лобби")
        # хозяин — за спецназ, гость — за террористов
        teams = {lobby["members"][0]: "ct", lobby["members"][1]: "t"}
        lobby["room"] = self.start_game(lobby["code"], dict(lobby["settings"]), teams)
        await self.push_lobby(lobby)
        for m in lobby["members"]:
            await self.send(m, {"type": "lobbyStart", "room": lobby["room"]})

    # ---------- соединение ----------
    async def handler(self, request):
        ws = web.WebSocketResponse(heartbeat=15)
        await ws.prepare(request)
        pid = None
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if not isinstance(data, dict):
                    continue
                kind = data.get("type")
                name = str(data.get("name") or "").strip()[:16]

                if kind == "hello" and pid is None:
                    pid = self.pid_by_token(data.get("token"))
                    if pid is None:
                        p = self.new_profile(name or "Игрок")
                        pid = p["id"]
                        await ws.send_str(json.dumps({"type": "token", "token": p["token"]}))
                    elif name and name != self.profiles[pid]["name"]:
                        self.profiles[pid]["name"] = name
                        self.save()
                    first = pid not in self.sessions
                    self.sessions.setdefault(pid, set()).add(ws)
                    self.check_achievements(pid)   # достижения за то, что уже сделано раньше
                    self.save()
                    await self.push_me(pid)
                    await self.push_friends(pid)
                    lobby = self.lobbies.get(self.lobby_of.get(pid))
                    await ws.send_str(json.dumps({"type": "lobby", "lobby": lobby and self.lobby_public(lobby)}))
                    if first:
                        await self.push_friends_of(pid)  # друзья видят, что он в сети
                    continue
                if pid is None:
                    continue

                if kind == "setName" and name and name != self.profiles[pid]["name"]:
                    self.profiles[pid]["name"] = name
                    self.save()
                    await self.push_me(pid)
                    await self.push_friends_of(pid)
                elif kind == "friendAdd":
                    await self.friend_add(pid, str(data.get("code", ""))[:24])
                elif kind == "friendAccept":
                    await self.friend_accept(pid, str(data.get("id")))
                elif kind == "friendRemove":
                    await self.friend_remove(pid, str(data.get("id")))
                elif kind == "leaders":
                    await ws.send_str(json.dumps(self.leaders(), ensure_ascii=False))
                elif kind == "profileGet":
                    await self.profile_get(pid, str(data.get("id")))
                elif kind == "lobbyCreate":
                    await self.lobby_create(pid)
                elif kind == "lobbyJoin":
                    await self.lobby_join(pid, str(data.get("code", ""))[:8])
                elif kind == "lobbyLeave":
                    await self.lobby_leave(pid)
                elif kind == "lobbyInvite":
                    await self.lobby_invite(pid, str(data.get("id")))
                elif kind == "lobbySettings":
                    await self.lobby_settings(pid, data.get("settings"))
                elif kind == "lobbyStart":
                    await self.lobby_start(pid)
        finally:
            if pid is not None:
                conns = self.sessions.get(pid, set())
                conns.discard(ws)
                if not conns:
                    # закрыл игру совсем — выходит из лобби, друзья видят «не в сети»
                    self.sessions.pop(pid, None)
                    await self.lobby_leave(pid)
                    await self.push_friends_of(pid)
        return ws
