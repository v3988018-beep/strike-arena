"""Профили, друзья и лобби 1 на 1.

Каждый браузер получает профиль: ник, номер (#1234) и секретный ключ (token),
который хранится у игрока в localStorage — по нему сервер узнаёт его при следующем входе.
Профили лежат в data/profiles.json, а на сервере в интернете — в базе данных Postgres
(переменная DATABASE_URL): диск хостинга стирается при каждом перезапуске.

Меню держит отдельное соединение /social: через него приходят заявки в друзья,
кто из друзей в сети, приглашения в лобби и настройки лобби.
"""
import asyncio
import json
import os
import time
import random
import secrets
import string
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from aiohttp import web, WSMsgType

import economy

DATA_FILE = Path(__file__).parent / "data" / "profiles.json"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_SAVE_DELAY = 3.0    # изменения копятся и пишутся в базу одной записью раз в несколько секунд
# Вход через Google: номер приложения из Google Cloud (он не секретный — виден в коде страницы)
GOOGLE_CLIENT_ID = os.environ.get(
    "GOOGLE_CLIENT_ID", "510296852748-vv4kuqedvrc491738nmpg0qgofdodkkc.apps.googleusercontent.com").strip()
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


async def verify_google(credential):
    """Проверить у Google, что вход настоящий и именно в нашу игру. Возвращает номер аккаунта (sub) или None."""
    import aiohttp
    if not GOOGLE_CLIENT_ID or not isinstance(credential, str) or len(credential) > 4096:
        return None
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as s:
            async with s.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential}) as r:
                if r.status != 200:
                    return None
                info = await r.json()
    except Exception as e:
        print(f"[google] не удалось проверить вход: {e!r}", flush=True)
        return None
    import time
    if (info.get("aud") != GOOGLE_CLIENT_ID or info.get("iss") not in GOOGLE_ISSUERS
            or int(info.get("exp", 0)) < time.time() or not info.get("sub")):
        return None
    return str(info["sub"])


def db_dsn(url):
    """asyncpg понимает из параметров адреса только sslmode — остальные (например channel_binding
    из адреса Neon) он принял бы за настройки сервера и не подключился бы."""
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k == "sslmode"]
    return urlunsplit(parts._replace(query=urlencode(query)))
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
    "bots": [False, True],                         # боты добивают команды до размера большей
}
LOBBY_MAX, LOBBY_TEAM_MAX = 10, 5                  # лобби — до 5 на 5


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
    ("smoke_10", "Сквозь дым", "10 убийств через смок", "smoke_kills", 10, 300),
    ("blind_3", "Наугад", "3 убийства вслепую, после флешки", "blind_kills", 3, 300),
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


# Обмен: с какого уровня (или сразу после входа через Google), сколько скинов за раз,
# сколько секунд ждать после «Готов» у обоих до кнопки «Подтвердить», сколько живёт приглашение
TRADE_MIN_LEVEL = 5
TRADE_MAX_ITEMS = 10
TRADE_CONFIRM_DELAY = 5.0
TRADE_INVITE_TTL = 60
TRADE_HISTORY = 20


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
        self.by_google = {}               # номер Google-аккаунта → id профиля
        self.sessions = {}                # id → множество соединений /social (вкладки браузера)
        self.in_game = set()              # кто сейчас в игре
        self.lobbies = {}                 # код → лобби
        self.lobby_of = {}                # id игрока → код лобби
        self.market = economy.Market()    # рынок скинов между игроками
        # обмен скинами между друзьями: идущие обмены живут только в памяти (перезапуск сервера их отменяет)
        self.trades = {}                  # id → обмен
        self.trade_of = {}                # id игрока → id его обмена
        self.trade_invites = {}           # (кто зовёт, кого) → когда
        self.next_trade = 1
        # база данных (на хостинге): пул соединений, прочитана ли она, есть ли несохранённое
        self.db = None
        self.db_ok = False
        self.dirty = False
        self.flush_task = None
        if not DATABASE_URL:
            self.load()

    # ---------- хранение ----------
    def load(self):
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        self.apply(data)

    def apply(self, data):
        for p in data.get("profiles", []):
            # опыт появился позже — старым профилям начисляем его за уже сделанные убийства и победы
            p["stats"].setdefault("xp", p["stats"].get("kills", 0) * 20 + p["stats"].get("wins", 0) * 100)
            p["stats"].setdefault("elo", START_ELO)
            p.setdefault("ach", [])
            p["wallet"] = economy.migrate(p.get("wallet"))   # кошелёк считает сервер (старые — переносим)
            self.profiles[p["id"]] = p
            self.by_token[p["token"]] = p["id"]
            if p.get("google"):
                self.by_google[p["google"]] = p["id"]
        self.market = economy.Market(data.get("market"))

    def dump(self):
        """Всё, что хранится: профили и рынок."""
        return json.dumps({"profiles": list(self.profiles.values()), "market": self.market.dump()}, ensure_ascii=False)

    def save(self):
        if DATABASE_URL:
            # в базу пишем не на каждое изменение, а пачкой через несколько секунд
            self.dirty = True
            if self.db_ok and (self.flush_task is None or self.flush_task.done()):
                self.flush_task = asyncio.get_running_loop().create_task(self.flush_later(DB_SAVE_DELAY))
            return
        DATA_FILE.parent.mkdir(exist_ok=True)
        tmp = DATA_FILE.with_suffix(".tmp")
        tmp.write_text(self.dump(), encoding="utf-8")
        tmp.replace(DATA_FILE)  # сначала во временный файл — чтобы не испортить при сбое

    # ---------- база данных (сервер в интернете) ----------
    async def start(self, app=None):
        """Запуск сервера: читаем все профили из базы. Если прочитать не удалось — в базу НИЧЕГО
        не пишем (db_ok остаётся False), иначе пустой список профилей затёр бы настоящие."""
        if not DATABASE_URL:
            return
        import asyncpg   # нужен только на хостинге
        for attempt in range(5):
            try:
                # statement_cache_size=0 — чтобы работало и через пул соединений Neon (pgbouncer)
                self.db = await asyncpg.create_pool(db_dsn(DATABASE_URL), min_size=1, max_size=2,
                                                    statement_cache_size=0)
                await self.db.execute("CREATE TABLE IF NOT EXISTS store "
                                      "(key text PRIMARY KEY, data text NOT NULL, updated timestamptz DEFAULT now())")
                row = await self.db.fetchrow("SELECT data FROM store WHERE key = 'profiles'")
                self.apply(json.loads(row["data"]) if row else {})
                self.db_ok = True
                print(f"[база] профилей загружено: {len(self.profiles)}", flush=True)
                if self.dirty:   # кто-то успел зайти, пока база просыпалась
                    self.save()
                return
            except Exception as e:
                print(f"[база] не удалось подключиться (попытка {attempt + 1}): {e!r}", flush=True)
                if self.db:
                    await self.db.close()
                    self.db = None
                await asyncio.sleep(3 * (attempt + 1))
        print("[база] ВНИМАНИЕ: база недоступна — профили не будут сохраняться до перезапуска", flush=True)

    async def flush_later(self, delay):
        await asyncio.sleep(delay)
        await self.flush()

    async def flush(self):
        """Записать все профили в базу одной строкой. Не получилось — попробуем позже ещё раз."""
        if not (self.db_ok and self.dirty):
            return
        self.dirty = False
        data = self.dump()
        try:
            await self.db.execute(
                "INSERT INTO store (key, data, updated) VALUES ('profiles', $1, now()) "
                "ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated = now()", data)
        except Exception as e:
            print(f"[база] ошибка сохранения, повтор через 10 с: {e!r}", flush=True)
            self.dirty = True
            self.flush_task = asyncio.get_running_loop().create_task(self.flush_later(10))

    async def stop(self, app=None):
        """Сервер выключается (обновление на хостинге): сразу дописываем всё несохранённое."""
        if self.flush_task and not self.flush_task.done():
            self.flush_task.cancel()
        await self.flush()
        if self.db:
            await self.db.close()

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
                economy.add_gold(self.wallet(pid), gold)   # награда за достижение — золотом в кошелёк
                self.push_wallet(pid)
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
        """Опыт за игру: в профиль и сразу игроку — «+20 XP за убийство». Новый уровень — награда."""
        if pid not in self.profiles or amount <= 0:
            return
        self.record(pid, xp=amount)
        if pid in self.sessions:
            asyncio.get_event_loop().create_task(self.send(pid, {"type": "xp", "amount": amount, "reason": reason}))
        self.check_levels(pid)

    # ---------- кошелёк (золото, скины, кейсы) — считает только сервер ----------
    def wallet(self, pid):
        p = self.profiles[pid]
        if not p.get("wallet"):
            p["wallet"] = economy.new_wallet()
        return p["wallet"]

    def push_wallet(self, pid):
        if pid in self.sessions:
            w = economy.public(self.wallet(pid))
            asyncio.get_event_loop().create_task(self.send(pid, {"type": "wallet", "wallet": w}))

    def notify(self, pid, msg):
        if pid in self.sessions:
            asyncio.get_event_loop().create_task(self.send(pid, msg))

    def check_levels(self, pid):
        """Набран новый уровень — золото и кейсы за него (за каждый 5-й/10-й уровень)."""
        w = self.wallet(pid)
        level = level_info(self.profiles[pid]["stats"].get("xp", 0))[0]
        got = economy.level_up(w, level)
        if got:
            self.save()
            for r in got:
                self.notify(pid, {"type": "levelReward", **r})
            self.push_wallet(pid)

    def game_gold(self, pid, amount, reason):
        """Золото за игру (убийство, победа, MVP) — вызывает server.py."""
        if pid not in self.profiles or amount <= 0:
            return
        economy.add_gold(self.wallet(pid), amount)
        self.save()
        self.notify(pid, {"type": "gold", "amount": amount, "reason": reason})
        self.push_wallet(pid)

    def owner_grant(self, pid, gold, kills):
        """Владелец выдаёт себе золото и убийства (из панели читов; права проверяет server.py)."""
        if pid not in self.profiles:
            return
        if gold:
            economy.add_gold(self.wallet(pid), gold)
            self.notify(pid, {"type": "gold", "amount": gold, "reason": "от владельца"})
            self.push_wallet(pid)
        if kills:
            self.record(pid, kills=kills)   # сохранит и обновит меню (ножи открываются по убийствам)
        else:
            self.save()

    def owner_give_skin(self, pid, skin):
        """Владелец кладёт себе в инвентарь любой скин (из панели читов; права проверяет server.py)."""
        if pid not in self.profiles or not isinstance(skin, str) or skin not in economy.SKIN_BY_ID:
            return False
        economy.give_skin(self.wallet(pid), skin)
        self.save()
        self.push_wallet(pid)
        return True

    def game_mission(self, pid, *events):
        """Событие для заданий дня ('kill', 'kill:awp', 'head', 'round', ...) — вызывает server.py."""
        if pid not in self.profiles:
            return
        done = economy.mission_event(self.wallet(pid), {e for e in events if e})
        self.save()
        for d in done:
            self.notify(pid, {"type": "missionDone", "id": d["id"], "gold": d["gold"]})
        self.push_wallet(pid)

    async def wallet_action(self, pid, ws, data):
        """Просьбы из меню: купить скин, открыть кейс, надеть, забрать награду, рынок."""
        kind, w = data.get("type"), self.wallet(pid)
        reply = lambda msg: ws.send_str(json.dumps(msg, ensure_ascii=False))
        changed = False
        if kind == "buySkin":
            sid = data.get("id")
            changed = economy.buy_skin(w, sid)
            await reply({"type": "bought", "id": sid, "ok": changed})
        elif kind == "openCase":
            res = economy.open_case(w, data.get("id"))
            changed = res is not None
            await reply({"type": "caseResult", "case": data.get("id"), **(res or {"won": None})})
        elif kind == "equip":
            sid = data.get("id") if isinstance(data.get("id"), str) else None
            changed = economy.equip(w, str(data.get("slot", "")), sid)
        elif kind == "claimDaily":
            amount = economy.claim_daily(w)
            changed = amount > 0
            await reply({"type": "dailyClaimed", "amount": amount})
        elif kind == "claimMission":
            amount = economy.claim_mission(w, data.get("i"))
            changed = amount > 0
        elif kind == "market":
            await reply(self.market_view(pid))
        elif kind == "marketSell":
            price = data.get("price")
            price = int(price) if isinstance(price, (int, float)) and not isinstance(price, bool) and abs(price) < 1e12 else None
            lot, err = self.market.sell(pid, w, data.get("id"), price)
            changed = lot is not None
            await reply({"type": "marketResult", "action": "sell", "ok": changed, "error": err})
            if changed:
                await reply(self.market_view(pid))
        elif kind == "marketCancel":
            changed = self.market.cancel(pid, w, data.get("lot"))
            await reply({"type": "marketResult", "action": "cancel", "ok": changed})
            await reply(self.market_view(pid))
        elif kind == "marketBuy":
            lot = self.market.listings.get(data.get("lot"))
            seller = lot and self.profiles.get(lot["seller"])
            lot, earned, err = self.market.buy(pid, w, data.get("lot"), seller and self.wallet(seller["id"]))
            changed = lot is not None
            await reply({"type": "marketResult", "action": "buy", "ok": changed, "error": err,
                         "skin": lot and lot["skin"]})
            await reply(self.market_view(pid))
            if changed and seller:
                self.notify(seller["id"], {"type": "marketSold", "skin": lot["skin"], "price": lot["price"],
                                           "earned": earned})
                self.push_wallet(seller["id"])
        if changed:
            self.save()
        self.push_wallet(pid)

    def market_view(self, pid):
        """Все лоты (сначала дешёвые) и последние цены продаж по каждому скину."""
        lots = sorted(self.market.listings.values(), key=lambda lot: (lot["skin"], lot["price"], lot["at"]))
        name = lambda i: self.profiles[i]["name"] if i in self.profiles else "?"
        return {"type": "market", "fee": economy.MARKET["fee"],
                "lots": [{"id": lot["id"], "skin": lot["skin"], "price": lot["price"], "seller": name(lot["seller"]),
                          "mine": lot["seller"] == pid} for lot in lots[:1000]],
                "history": {k: [h[0] for h in v[-10:]] for k, v in self.market.history.items()}}

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
                              "google": bool(p.get("google")),
                              "trades": p.get("trades", [])[-10:], "tradeBlock": self.trade_block(pid),
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
                "members": [{**self.card(m), "team": lobby["teams"].get(m, "ct")} for m in lobby["members"]],
                "inGame": lobby["room"] is not None, "max": LOBBY_MAX, "teamMax": LOBBY_TEAM_MAX}

    def lobby_count(self, lobby, team):
        return sum(1 for m in lobby["members"] if lobby["teams"].get(m) == team)

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
        lobby = {"code": code, "host": pid, "members": [pid], "teams": {pid: "ct"},
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
        if len(lobby["members"]) >= LOBBY_MAX:
            return await self.notice(pid, f"Лобби уже заполнено ({LOBBY_TEAM_MAX} на {LOBBY_TEAM_MAX})")
        if lobby["room"]:
            return await self.notice(pid, "В этом лобби уже идёт игра")
        await self.lobby_leave(pid)
        lobby["members"].append(pid)
        # новичок — в команду, где меньше игроков
        lobby["teams"][pid] = "t" if self.lobby_count(lobby, "t") < self.lobby_count(lobby, "ct") else "ct"
        self.lobby_of[pid] = lobby["code"]
        await self.push_lobby(lobby)
        await self.push_friends_of(pid)

    async def lobby_leave(self, pid):
        code = self.lobby_of.pop(pid, None)
        lobby = self.lobbies.get(code)
        if not lobby:
            return
        lobby["members"].remove(pid)
        lobby["teams"].pop(pid, None)
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
        if len(lobby["members"]) >= LOBBY_MAX:
            return await self.notice(pid, "Лобби уже заполнено")
        await self.send(oid, {"type": "invite", "code": lobby["code"],
                              "from": {"id": pid, "name": me["name"], "tag": me["tag"]}})
        await self.notice(pid, f"Приглашение отправлено: {self.profiles[oid]['name']}")

    async def lobby_team(self, pid, team):
        """Перейти в другую команду лобби (если там есть место)."""
        lobby = self.lobbies.get(self.lobby_of.get(pid))
        if not lobby or lobby["room"] or team not in ("ct", "t") or lobby["teams"].get(pid) == team:
            return
        if self.lobby_count(lobby, team) >= LOBBY_TEAM_MAX:
            return await self.notice(pid, "В этой команде уже нет мест")
        lobby["teams"][pid] = team
        await self.push_lobby(lobby)

    async def lobby_kick(self, pid, oid):
        """Хозяин убирает игрока из лобби."""
        lobby = self.lobbies.get(self.lobby_of.get(pid))
        if not lobby or lobby["host"] != pid or oid == pid or oid not in lobby["members"] or lobby["room"]:
            return
        await self.lobby_leave(oid)
        await self.notice(oid, "Хозяин убрал тебя из лобби")

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
        teams = {m: lobby["teams"].get(m, "ct") for m in lobby["members"]}
        if not lobby["settings"].get("bots") and len(set(teams.values())) < 2:
            return await self.notice(pid, "В обеих командах должен быть хотя бы один игрок — или включи ботов")
        lobby["room"] = self.start_game(lobby["code"], dict(lobby["settings"]), teams)
        await self.push_lobby(lobby)
        for m in lobby["members"]:
            await self.send(m, {"type": "lobbyStart", "room": lobby["room"]})

    # ---------- соединение ----------
    # ---------- обмен скинами между друзьями ----------
    # Защита: только друзья и только скины (без золота — иначе твинки сливали бы золото на главный профиль),
    # с 5-го уровня или после входа через Google, новый (и полученный в обмене) скин — через 24 ч.
    # В окне обмена любое изменение снимает «Готов» у обоих; «Подтвердить» — только через 5 с после «Готов»,
    # чтобы в последний момент не подсунули другой скин
    def trade_block(self, pid):
        """Почему этому игроку пока нельзя меняться (или None)."""
        p = self.profiles[pid]
        if p.get("google") or level_info(p["stats"].get("xp", 0))[0] >= TRADE_MIN_LEVEL:
            return None
        return f"Обмен открывается с {TRADE_MIN_LEVEL} уровня или после входа через Google"

    def tradable(self, pid, skin_id, now):
        w = self.wallet(pid)
        lock = economy.MARKET["tradeLockHours"] * 3600
        return skin_id in w["owned"] and w["got"].get(skin_id, 0) + lock <= now

    def trade_side(self, t, pid):
        return "a" if t["a"] == pid else "b"

    def trade_state(self, t, pid):
        me, other = self.trade_side(t, pid), "b" if self.trade_side(t, pid) == "a" else "a"
        oid, now = t[other], time.time()
        both = t["ready"]["a"] and t["ready"]["b"]
        lock = economy.MARKET["tradeLockHours"] * 3600
        w = self.wallet(pid)
        return {"type": "trade", "id": t["id"],
                "partner": {"id": oid, "name": self.profiles[oid]["name"], "tag": self.profiles[oid]["tag"]},
                "mine": t["items"][me], "theirs": t["items"][other],
                "myReady": t["ready"][me], "theirReady": t["ready"][other],
                "myConfirm": t["confirm"][me], "theirConfirm": t["confirm"][other],
                "confirmIn": max(0.0, t["ready_at"] + TRADE_CONFIRM_DELAY - now) if both else None,
                "partnerOwned": self.wallet(oid)["owned"],
                "locked": [k for k, v in w["got"].items() if v + lock > now]}

    async def trade_push(self, t):
        for side in ("a", "b"):
            await self.send(t[side], self.trade_state(t, t[side]))

    async def trade_invite(self, pid, oid, reply):
        me, now = self.profiles[pid], time.time()
        if oid not in me["friends"] or oid not in self.profiles:
            return await reply("Меняться можно только с друзьями")
        if oid not in self.sessions:
            return await reply("Друг сейчас не в сети")
        err = self.trade_block(pid)
        if err:
            return await reply(err)
        if self.trade_block(oid):
            return await reply(f"У друга обмен ещё закрыт: нужен {TRADE_MIN_LEVEL} уровень или вход через Google")
        if pid in self.trade_of or oid in self.trade_of:
            return await reply("Кто-то из вас уже меняется")
        self.trade_invites[(pid, oid)] = now
        await self.send(oid, {"type": "tradeInvite", "from": {"id": pid, "name": me["name"], "tag": me["tag"]}})
        await reply("Приглашение к обмену отправлено", ok=True)

    async def trade_accept(self, pid, fid, reply):
        at = self.trade_invites.pop((fid, pid), None)
        if not at or time.time() - at > TRADE_INVITE_TTL or fid not in self.sessions:
            return await reply("Приглашение устарело")
        if pid in self.trade_of or fid in self.trade_of:
            return await reply("Кто-то из вас уже меняется")
        if self.trade_block(pid) or self.trade_block(fid):
            return await reply(self.trade_block(pid) or "У друга обмен ещё закрыт")
        t = {"id": self.next_trade, "a": fid, "b": pid, "items": {"a": [], "b": []},
             "ready": {"a": False, "b": False}, "confirm": {"a": False, "b": False}, "ready_at": 0.0}
        self.next_trade += 1
        self.trades[t["id"]] = t
        self.trade_of[fid] = self.trade_of[pid] = t["id"]
        await self.trade_push(t)

    async def trade_set(self, pid, items, reply):
        """Что я отдаю. Любое изменение снимает «Готов» и подтверждение у обоих."""
        t = self.trades.get(self.trade_of.get(pid))
        if not t:
            return
        side = self.trade_side(t, pid)
        other = t["b" if side == "a" else "a"]
        if not isinstance(items, list) or len(items) > TRADE_MAX_ITEMS:
            return await reply(f"Не больше {TRADE_MAX_ITEMS} скинов за один обмен")
        items = list(dict.fromkeys(i for i in items if isinstance(i, str)))
        now = time.time()
        for i in items:
            if not self.tradable(pid, i, now):
                return await reply("Этот скин нельзя отдать: его нет или он получен меньше суток назад")
            if i in self.wallet(other)["owned"]:
                return await reply("Такой скин у друга уже есть")
        t["items"][side] = items
        t["ready"] = {"a": False, "b": False}
        t["confirm"] = {"a": False, "b": False}
        await self.trade_push(t)

    async def trade_ready(self, pid, on):
        t = self.trades.get(self.trade_of.get(pid))
        if not t:
            return
        t["ready"][self.trade_side(t, pid)] = bool(on)
        t["confirm"] = {"a": False, "b": False}
        if t["ready"]["a"] and t["ready"]["b"]:
            t["ready_at"] = time.time()
        await self.trade_push(t)

    async def trade_confirm(self, pid, reply):
        t = self.trades.get(self.trade_of.get(pid))
        if not t or not (t["ready"]["a"] and t["ready"]["b"]):
            return
        if time.time() < t["ready_at"] + TRADE_CONFIRM_DELAY:
            return await reply("Подожди пару секунд и проверь, что отдаёт друг")
        t["confirm"][self.trade_side(t, pid)] = True
        if t["confirm"]["a"] and t["confirm"]["b"]:
            await self.trade_finish(t)
        else:
            await self.trade_push(t)

    async def trade_finish(self, t):
        """Обе стороны подтвердили — ещё раз всё проверяем и меняем скины местами."""
        now = time.time()
        a, b = t["a"], t["b"]
        give = {a: t["items"]["a"], b: t["items"]["b"]}
        ok = bool(give[a] or give[b]) and all(
            self.tradable(pid, i, now) and i not in self.wallet(b if pid == a else a)["owned"]
            for pid in (a, b) for i in give[pid])
        if not ok:
            await self.trade_close(t, "Обмен не состоялся: скины изменились, начните заново")
            return
        for giver, taker in ((a, b), (b, a)):
            for i in give[giver]:
                economy.take_skin(self.wallet(giver), i)
                economy.give_skin(self.wallet(taker), i, now)   # полученный скин — снова на 24 ч под замком
        for me, other in ((a, b), (b, a)):
            hist = self.profiles[me].setdefault("trades", [])
            hist.append({"at": int(now), "with": self.profiles[other]["name"], "withTag": self.profiles[other]["tag"],
                         "gave": give[me], "got": give[other]})
            del hist[:-TRADE_HISTORY]
        self.save()
        self.trades.pop(t["id"], None)
        for pid in (a, b):
            self.trade_of.pop(pid, None)
            other = b if pid == a else a
            await self.send(pid, {"type": "tradeDone", "gave": give[pid], "got": give[other]})
            self.push_wallet(pid)
            await self.push_me(pid)

    async def trade_close(self, t, reason):
        self.trades.pop(t["id"], None)
        for pid in (t["a"], t["b"]):
            self.trade_of.pop(pid, None)
            await self.send(pid, {"type": "tradeClosed", "reason": reason})

    async def trade_action(self, pid, ws, data):
        kind = data.get("type")

        async def reply(text, ok=False):
            await ws.send_str(json.dumps({"type": "tradeResult", "ok": ok, "text": text}, ensure_ascii=False))

        if kind == "tradeInvite":
            await self.trade_invite(pid, str(data.get("id")), reply)
        elif kind == "tradeAccept":
            await self.trade_accept(pid, str(data.get("id")), reply)
        elif kind == "tradeDecline":
            if self.trade_invites.pop((str(data.get("id")), pid), None):
                await self.send(str(data.get("id")), {"type": "tradeClosed",
                                                      "reason": f"{self.profiles[pid]['name']} отказался от обмена"})
        elif kind == "tradeSet":
            await self.trade_set(pid, data.get("items"), reply)
        elif kind == "tradeReady":
            await self.trade_ready(pid, data.get("on"))
        elif kind == "tradeConfirm":
            await self.trade_confirm(pid, reply)
        elif kind == "tradeCancel":
            t = self.trades.get(self.trade_of.get(pid))
            if t:
                await self.trade_close(t, f"{self.profiles[pid]['name']} отменил обмен")

    async def google_login(self, pid, ws, credential):
        """Вход через Google. Аккаунт уже привязан к профилю — переключаем браузер на тот профиль
        (так прогресс переезжает на новое устройство). Не привязан — привязываем к текущему."""
        reply = lambda msg: ws.send_str(json.dumps({"type": "google", **msg}, ensure_ascii=False))
        sub = await verify_google(credential)
        if sub is None:
            await reply({"ok": False})
            return
        other = self.by_google.get(sub)
        if other == pid:
            await reply({"ok": True, "linked": True})
            return
        if other is not None:
            await reply({"ok": True, "switch": self.profiles[other]["token"]})
            return
        p = self.profiles[pid]
        if p.get("google"):
            # этот профиль уже принадлежит другому Google-аккаунту — новому аккаунту новый профиль
            np = self.new_profile(p["name"])
            np["google"] = sub
            self.by_google[sub] = np["id"]
            self.save()
            await reply({"ok": True, "switch": np["token"], "fresh": True})
            return
        p["google"] = sub
        self.by_google[sub] = pid
        self.save()
        await self.push_me(pid)
        await reply({"ok": True, "linked": True})

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
                    # кошелёк считает сервер: браузер просто показывает то, что пришло
                    self.check_levels(pid)
                    await ws.send_str(json.dumps({"type": "wallet", "wallet": economy.public(self.wallet(pid))},
                                                 ensure_ascii=False))
                    await self.push_friends(pid)
                    lobby = self.lobbies.get(self.lobby_of.get(pid))
                    await ws.send_str(json.dumps({"type": "lobby", "lobby": lobby and self.lobby_public(lobby)}))
                    if first:
                        await self.push_friends_of(pid)  # друзья видят, что он в сети
                    t = self.trades.get(self.trade_of.get(pid))
                    if t:   # обновил страницу посреди обмена — окно обмена возвращается
                        await ws.send_str(json.dumps(self.trade_state(t, pid), ensure_ascii=False))
                    continue
                if pid is None:
                    continue

                if kind == "setName" and name and name != self.profiles[pid]["name"]:
                    self.profiles[pid]["name"] = name
                    self.save()
                    await self.push_me(pid)
                    await self.push_friends_of(pid)
                elif kind in ("walletGet", "buySkin", "openCase", "equip", "claimDaily", "claimMission",
                              "market", "marketSell", "marketCancel", "marketBuy"):
                    await self.wallet_action(pid, ws, data)
                elif kind in ("tradeInvite", "tradeAccept", "tradeDecline", "tradeSet", "tradeReady",
                              "tradeConfirm", "tradeCancel"):
                    await self.trade_action(pid, ws, data)
                elif kind == "google":
                    await self.google_login(pid, ws, data.get("credential"))
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
                elif kind == "lobbyTeam":
                    await self.lobby_team(pid, data.get("team"))
                elif kind == "lobbyKick":
                    await self.lobby_kick(pid, str(data.get("id")))
        finally:
            if pid is not None:
                conns = self.sessions.get(pid, set())
                conns.discard(ws)
                if not conns:
                    # закрыл игру совсем — выходит из лобби и обмена, друзья видят «не в сети»
                    self.sessions.pop(pid, None)
                    await self.lobby_leave(pid)
                    t = self.trades.get(self.trade_of.get(pid))
                    if t:
                        await self.trade_close(t, f"{self.profiles[pid]['name']} вышел из игры — обмен отменён")
                    await self.push_friends_of(pid)
        return ws
